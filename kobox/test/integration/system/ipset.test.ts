import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';
import { IpsetAdapter } from '../../../src/infrastructure/system/IpsetAdapter.js';

// Kernel-mutating suite: privileged dev container only (Phase 3 double
// guard). Docker Desktop kernels may lack ip_set — the adapter must then
// answer false, never throw, which is itself asserted here.
const inContainerAsRoot =
  process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/.dockerenv');

const adapter = new IpsetAdapter(new ExecFileRunner());

describe.runIf(inContainerAsRoot)('IpsetAdapter (real ipset)', () => {
  afterAll(() => {
    try {
      execFileSync('ipset', ['destroy', 'kobox-bl']);
    } catch {
      // set never existed (unsupported kernel) — nothing to clean
    }
  });

  it('should_answer_supported_or_not_without_throwing', async () => {
    const supported = await adapter.ensureBlocklistSet();
    expect(typeof supported).toBe('boolean');
    if (supported) {
      // -exist makes the probe idempotent
      expect(await adapter.ensureBlocklistSet()).toBe(true);
    }
  });

  it('should_load_and_swap_a_rendered_restore_file', async () => {
    if (!(await adapter.ensureBlocklistSet())) {
      console.warn('ipset unsupported in this kernel — restore path validated on the VM');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'kobox-ipset-'));
    const file = join(dir, 'blocklist.ipset');
    writeFileSync(
      file,
      [
        'create kobox-bl hash:net family inet maxelem 1048576 -exist',
        'create kobox-bl-next hash:net family inet maxelem 1048576 -exist',
        'flush kobox-bl-next',
        'add kobox-bl-next 192.0.2.0/24',
        'add kobox-bl-next 198.51.100.1-198.51.100.9',
        'swap kobox-bl kobox-bl-next',
        'destroy kobox-bl-next',
        '',
      ].join('\n'),
    );

    await adapter.restore(file);

    const listing = execFileSync('ipset', ['list', 'kobox-bl'], { encoding: 'utf8' });
    expect(listing).toContain('192.0.2.0/24');
    // the a-b range arrived as prefixes
    expect(listing).toContain('198.51.100.');
    expect(() => execFileSync('ipset', ['list', 'kobox-bl-next'])).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
