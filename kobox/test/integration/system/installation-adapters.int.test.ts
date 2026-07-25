import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { renderSshdDropin } from '../../../src/domain/installation/rendering.js';
import { Username } from '../../../src/domain/user/Username.js';
import { AptPackageAdapter } from '../../../src/infrastructure/system/AptPackageAdapter.js';
import { ConfigCheckAdapter } from '../../../src/infrastructure/system/ConfigCheckAdapter.js';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';
import { EasyRsaPkiAdapter } from '../../../src/infrastructure/system/EasyRsaPkiAdapter.js';
import { InstallHostAdapter } from '../../../src/infrastructure/system/InstallHostAdapter.js';
import { SystemFactsAdapter } from '../../../src/infrastructure/system/SystemFactsAdapter.js';

// apt/easy-rsa/sshd mutations are confined to the privileged dev container
// (same double guard as every system suite).
const inContainerAsRoot =
  process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/.dockerenv');

const runner = new ExecFileRunner();

describe.runIf(inContainerAsRoot)('SystemFactsAdapter (real host)', () => {
  it('should_report_the_container_debian_12_facts', async () => {
    const facts = await new SystemFactsAdapter(runner).gather();

    expect(facts.osId).toBe('debian');
    expect(facts.osVersionId).toBe('12');
    expect(['amd64', 'arm64']).toContain(facts.arch);
    expect(facts.euid).toBe(0);
    expect(facts.rootFsType.length).toBeGreaterThan(0);
    expect(facts.hasDefaultRoute).toBe(true);
  });
});

describe.runIf(inContainerAsRoot)('AptPackageAdapter (real apt)', () => {
  it('should_install_a_small_package_idempotently_and_answer_availability', async () => {
    const apt = new AptPackageAdapter(runner);

    // the orchestrator always refreshes once before installing; the image
    // strips /var/lib/apt/lists so the index must exist first
    await apt.refresh();
    await apt.ensureInstalled(['zip']);
    expect(await apt.isInstalled('zip')).toBe(true);
    expect(await apt.installedVersion('zip')).toMatch(/^[0-9]/);

    // second run must be pure queries — proven by wall clock (no apt lock)
    const start = Date.now();
    await apt.ensureInstalled(['zip']);
    expect(Date.now() - start).toBeLessThan(2_000);

    expect(await apt.isAvailable('rtorrent')).toBe(true);
    expect(await apt.isAvailable('pgld')).toBe(false); // the Debian 12 reality
  }, 120_000);
});

describe.runIf(inContainerAsRoot)('EasyRsaPkiAdapter (real easy-rsa)', () => {
  const pkiDir = join(mkdtempSync(join(tmpdir(), 'kobox-pki-int-')), 'pki');
  const adapter = new EasyRsaPkiAdapter(runner, pkiDir);
  const alice = Username.parse('alice');

  afterAll(() => {
    rmSync(join(pkiDir, '..'), { recursive: true, force: true });
  });

  it('should_bootstrap_an_ec_pki_and_issue_readable_client_material', async () => {
    await adapter.ensurePki();
    expect(existsSync(join(pkiDir, 'ca.crt'))).toBe(true);
    expect(existsSync(join(pkiDir, 'issued/server.crt'))).toBe(true);
    // EC PKI: no dh.pem anywhere (servers run `dh none`)
    expect(existsSync(join(pkiDir, 'dh.pem'))).toBe(false);

    await adapter.ensureClientMaterial(alice);
    const material = await adapter.clientMaterial(alice);
    expect(material?.caCrt).toContain('BEGIN CERTIFICATE');
    expect(material?.userKey).toContain('PRIVATE KEY');

    await adapter.removeClientMaterial(alice);
    expect(await adapter.clientMaterial(alice)).toBeUndefined();
  }, 120_000);
});

describe.runIf(inContainerAsRoot)('sshd guard (real sshd -t)', () => {
  it('should_accept_the_rendered_dropin_and_reject_a_poisoned_one', async () => {
    const host = new InstallHostAdapter(runner);
    const checks = new ConfigCheckAdapter(runner);
    const dropin = renderSshdDropin(22);

    await host.ensureDir('/etc/ssh/sshd_config.d', '0755');
    const created = await host.ensureFile(dropin);
    expect(await checks.sshd()).toEqual({ ok: true });
    if (created) {
      await host.removeFile(dropin.path);
    }

    const poisoned = { ...dropin, path: '/etc/ssh/sshd_config.d/99-kobox-poison.conf', content: 'NotAnOption yes\n' };
    await host.ensureFile(poisoned);
    const verdict = await checks.sshd();
    await host.removeFile(poisoned.path);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.detail).toContain('NotAnOption');
    // the stock config is intact after removal
    expect(await checks.sshd()).toEqual({ ok: true });
  });
});

describe.runIf(inContainerAsRoot)('InstallHostAdapter postmap (real postfix tools)', () => {
  it('should_compile_a_credentials_map_next_to_its_source', async () => {
    const host = new InstallHostAdapter(runner);
    // the test owns its precondition (Phase 3 lesson): postfix may or may not
    // be installed yet depending on suite order
    await host.preseedDebconf([
      'postfix postfix/main_mailer_type select Local only',
      'postfix postfix/mailname string kobox-test',
    ]);
    await new AptPackageAdapter(runner).ensureInstalled(['postfix']);
    const source = '/etc/postfix/kobox-postmap-test';
    await host.ensureFile({
      path: source,
      content: '[relay.example.net]:587 login:secret\n',
      mode: '0600',
      owner: 'root',
      group: 'root',
    });

    await host.postmap(source);

    expect(existsSync(`${source}.db`)).toBe(true);
    await host.removeFile(source);
    await host.removeFile(`${source}.db`);
  }, 180_000);
});
