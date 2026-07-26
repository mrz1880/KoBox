import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderNanomonUnit } from '../../src/domain/installation/rendering.js';

// Monitoring E2E on a fresh Debian 12: the REAL rendered kobox-nanomon.service
// starts a binary as the dedicated non-root account, bound to loopback. A stub
// HTTP server stands in for the Rust binary — KoBox owns the wiring (unit, user,
// loopback), not NanoMon's internals (which NanoMon's own tests cover), exactly
// as the security/portal E2Es stage fixture PKI rather than run easy-rsa.

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const BIN = '/usr/local/bin/nanomon';
const UNIT = '/etc/systemd/system/kobox-nanomon.service';

// reads NANOMON_BIND/NANOMON_PORT from the unit's Environment= lines
const STUB = `#!/usr/bin/env node
const http = require('http');
http
  .createServer((_req, res) => { res.writeHead(200); res.end('nanomon-stub'); })
  .listen(Number(process.env.NANOMON_PORT), process.env.NANOMON_BIND);
`;

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

describe.skipIf(!onDebianAsRoot)('E2E: kobox-nanomon runs non-root on loopback', () => {
  beforeAll(async () => {
    writeFileSync(BIN, STUB);
    chmodSync(BIN, 0o755);
    try {
      execFileSync('groupadd', ['--system', 'nanomon'], { stdio: 'ignore' });
    } catch {
      /* already exists */
    }
    try {
      execFileSync(
        'useradd',
        ['--system', '--gid', 'nanomon', '--no-create-home', '--shell', '/usr/sbin/nologin', 'nanomon'],
        { stdio: 'ignore' },
      );
    } catch {
      /* already exists */
    }
    // the REAL rendered unit — this is what `kobox install` writes
    writeFileSync(UNIT, renderNanomonUnit().content);
    execFileSync('systemctl', ['daemon-reload']);
    execFileSync('systemctl', ['enable', '--now', 'kobox-nanomon'], { stdio: 'ignore' });
    for (let i = 0; i < 25; i += 1) {
      try {
        execFileSync('curl', ['-fsS', 'http://127.0.0.1:8191/'], { stdio: 'ignore' });
        break;
      } catch {
        await sleep(200);
      }
    }
  });

  afterAll(() => {
    try {
      execFileSync('systemctl', ['disable', '--now', 'kobox-nanomon'], { stdio: 'ignore' });
    } catch {
      /* not started */
    }
  });

  it('should_run_the_unit_as_the_nanomon_user', () => {
    expect(sh('systemctl', ['is-active', 'kobox-nanomon']).trim()).toBe('active');
    expect(sh('systemctl', ['show', '-p', 'User', '--value', 'kobox-nanomon']).trim()).toBe('nanomon');
  });

  it('should_serve_only_on_loopback', () => {
    expect(sh('curl', ['-fsS', 'http://127.0.0.1:8191/'])).toBe('nanomon-stub');
    const listeners = sh('ss', ['-ltnH']);
    expect(listeners).toContain('127.0.0.1:8191');
    expect(listeners).not.toContain('0.0.0.0:8191');
  });
});
