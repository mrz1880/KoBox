import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RenderedFile } from '../../../../src/domain/shared/files.js';
import type {
  HealthCheckResult,
  HealthProbePort,
} from '../../../../src/domain/user/ports.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { DynDnsHost } from '../../../../src/domain/security/DynDnsHost.js';
import { DynDnsLookupAdapter } from '../../../../src/infrastructure/system/DynDnsLookupAdapter.js';
import { FsVpnPkiAdapter } from '../../../../src/infrastructure/system/FsVpnPkiAdapter.js';
import { GetentUserIdentityAdapter } from '../../../../src/infrastructure/system/GetentUserIdentityAdapter.js';
import { IptablesRestoreAdapter } from '../../../../src/infrastructure/system/IptablesRestoreAdapter.js';
import { NetworkServiceAdapter } from '../../../../src/infrastructure/system/NetworkServiceAdapter.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { createLogger } from '../../../../src/infrastructure/logging/logger.js';

process.env.KOBOX_LOG_LEVEL = 'silent';
const logger = createLogger('test');

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  private readonly byCommand = new Map<string, CommandResult>();

  on(command: string, result: Partial<CommandResult>): void {
    this.byCommand.set(command, { stdout: '', stderr: '', exitCode: 0, ...result });
  }

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve(
      this.byCommand.get(request.command) ?? { stdout: '', stderr: '', exitCode: 0 },
    );
  }
}

class StubProbe implements HealthProbePort {
  state: 'healthy' | 'unhealthy' = 'healthy';

  checkProcess(name: string): Promise<HealthCheckResult> {
    return Promise.resolve({ name, state: this.state });
  }

  checkSocket(host: string, port: number): Promise<HealthCheckResult> {
    return Promise.resolve({ name: `${host}:${String(port)}`, state: this.state });
  }
}

class RecordingFiles {
  readonly applied: RenderedFile[] = [];

  apply(files: readonly RenderedFile[]): Promise<readonly string[]> {
    this.applied.push(...files);
    for (const file of files) {
      writeFileSync(file.path, file.content);
    }
    return Promise.resolve(files.map((file) => file.path));
  }
}

const SNAPSHOT = '*filter\n:INPUT ACCEPT [0:0]\nCOMMIT\n';

let dir: string;
let runner: RecordingRunner;
let probe: StubProbe;
let files: RecordingFiles;
let adapter: IptablesRestoreAdapter;
let rules: RenderedFile;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-fw-'));
  runner = new RecordingRunner();
  runner.on('iptables-save', { stdout: SNAPSHOT });
  probe = new StubProbe();
  files = new RecordingFiles();
  adapter = new IptablesRestoreAdapter(runner, files, probe, 22);
  rules = {
    path: join(dir, 'firewall.rules'),
    content: '*filter\n:INPUT DROP [0:0]\n-A INPUT -i lo -j ACCEPT\nCOMMIT\n',
    mode: '0600',
    owner: 'root',
    group: 'root',
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('IptablesRestoreAdapter', () => {
  it('should_snapshot_restore_probe_then_persist_the_file', async () => {
    const outcome = await adapter.apply(rules);

    expect(outcome).toBe('applied');
    expect(runner.calls.map((call) => call.command)).toEqual([
      'iptables-save',
      'iptables-restore',
    ]);
    // the ruleset travels via stdin — argv never carries rule content
    expect(runner.calls[1]?.stdin).toBe(rules.content);
    expect(runner.calls[1]?.timeoutMs).toBe(10_000);
    expect(files.applied).toHaveLength(1);
    expect(readFileSync(rules.path, 'utf8')).toBe(rules.content);
  });

  it('should_be_idempotent_when_the_persisted_rules_already_match', async () => {
    await adapter.apply(rules);
    runner.calls.length = 0;

    const outcome = await adapter.apply(rules);

    expect(outcome).toBe('unchanged');
    expect(runner.calls).toHaveLength(0); // no restore, no snapshot
  });

  it('should_restore_the_snapshot_and_keep_the_old_file_when_the_probe_fails', async () => {
    probe.state = 'unhealthy';

    const outcome = await adapter.apply(rules);

    expect(outcome).toBe('rolled-back');
    const restores = runner.calls.filter((call) => call.command === 'iptables-restore');
    expect(restores).toHaveLength(2);
    expect(restores[1]?.stdin).toBe(SNAPSHOT); // the pre-apply state came back
    // the file was NOT persisted: it must keep describing the live ruleset
    expect(files.applied).toHaveLength(0);
  });

  it('should_throw_and_leave_the_file_untouched_when_restore_itself_fails', async () => {
    runner.on('iptables-restore', { exitCode: 2, stderr: 'iptables-restore: line 2 failed' });

    await expect(adapter.apply(rules)).rejects.toThrow('line 2 failed');
    expect(files.applied).toHaveLength(0);
  });
});

class PrefixRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  private readonly rules: { prefix: string; result: CommandResult }[] = [];

  on(prefix: string, result: Partial<CommandResult>): void {
    this.rules.push({ prefix, result: { stdout: '', stderr: '', exitCode: 0, ...result } });
  }

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    const line = [request.command, ...request.args].join(' ');
    const match = this.rules.find((rule) => line.startsWith(rule.prefix));
    return Promise.resolve(match?.result ?? { stdout: '', stderr: '', exitCode: 0 });
  }

  commandLines(): readonly string[] {
    return this.calls.map((call) => [call.command, ...call.args].join(' '));
  }
}

describe('NetworkServiceAdapter', () => {
  it('should_reload_units_that_exist_and_escalate_their_failures', async () => {
    const runner = new PrefixRunner();
    runner.on('systemctl list-unit-files fail2ban.service', { stdout: 'fail2ban.service enabled\n' });
    const adapter = new NetworkServiceAdapter(runner, logger);

    await adapter.reloadFail2ban();
    expect(runner.commandLines()).toContain('systemctl reload-or-restart fail2ban');

    runner.on('systemctl reload-or-restart fail2ban', { exitCode: 1, stderr: 'boom' });
    await expect(adapter.reloadFail2ban()).rejects.toThrow('boom');
  });

  it('should_skip_absent_units_explicitly_instead_of_failing', async () => {
    const runner = new PrefixRunner(); // no units listed at all
    const adapter = new NetworkServiceAdapter(runner, logger);

    await adapter.reloadFail2ban();
    await adapter.reloadDns();
    await adapter.reloadPeerGuardian();

    const reloadCalls = runner
      .commandLines()
      .filter((line) => !line.startsWith('systemctl list-unit-files'));
    expect(reloadCalls).toEqual([]);
  });

  it('should_reload_bind_via_rndc_and_dnscrypt_via_try_restart', async () => {
    const runner = new PrefixRunner();
    runner.on('systemctl list-unit-files named.service', { stdout: 'named.service enabled\n' });
    runner.on('systemctl list-unit-files dnscrypt-proxy.service', {
      stdout: 'dnscrypt-proxy.service enabled\n',
    });
    const adapter = new NetworkServiceAdapter(runner, logger);

    await adapter.reloadDns();

    expect(runner.commandLines()).toContain('rndc reload');
    expect(runner.commandLines()).toContain('systemctl try-restart dnscrypt-proxy');
  });

  it('should_reload_peerguardian_through_pglcmd_when_the_unit_exists', async () => {
    const runner = new PrefixRunner();
    runner.on('systemctl list-unit-files pgl.service', { stdout: 'pgl.service enabled\n' });
    const adapter = new NetworkServiceAdapter(runner, logger);

    await adapter.reloadPeerGuardian();

    expect(runner.commandLines()).toContain('pglcmd reload');
  });
});

describe('FsVpnPkiAdapter', () => {
  it('should_read_client_material_from_an_easyrsa_tree', async () => {
    const pkiDir = mkdtempSync(join(tmpdir(), 'kobox-pki-'));
    mkdirSync(join(pkiDir, 'issued'), { recursive: true });
    mkdirSync(join(pkiDir, 'private'), { recursive: true });
    writeFileSync(join(pkiDir, 'ca.crt'), 'CA-PEM\n');
    writeFileSync(join(pkiDir, 'issued/alice.crt'), 'ALICE-PEM\n');
    writeFileSync(join(pkiDir, 'private/alice.key'), 'ALICE-KEY\n');
    const adapter = new FsVpnPkiAdapter(pkiDir);

    const material = await adapter.clientMaterial(Username.parse('alice'));
    expect(material).toEqual({ caCrt: 'CA-PEM', userCrt: 'ALICE-PEM', userKey: 'ALICE-KEY' });

    expect(await adapter.clientMaterial(Username.parse('bob'))).toBeUndefined();
    expect(adapter.serverPaths().serverKey).toBe(join(pkiDir, 'private/server.key'));
    rmSync(pkiDir, { recursive: true, force: true });
  });
});

describe('DynDnsLookupAdapter', () => {
  const host = DynDnsHost.parse('dyn.example.org');

  it('should_resolve_ipv4_via_the_injected_lookup', async () => {
    const adapter = new DynDnsLookupAdapter(() => Promise.resolve({ address: '203.0.113.9' }));
    expect((await adapter.resolve(host))?.value).toBe('203.0.113.9');
  });

  it('should_return_undefined_on_nxdomain_or_lookup_failure', async () => {
    const adapter = new DynDnsLookupAdapter(() => Promise.reject(new Error('ENOTFOUND')));
    expect(await adapter.resolve(host)).toBeUndefined();
  });

  it('should_return_undefined_when_the_answer_is_not_a_usable_ipv4', async () => {
    const adapter = new DynDnsLookupAdapter(() => Promise.resolve({ address: '::1' }));
    expect(await adapter.resolve(host)).toBeUndefined();
  });
});

describe('GetentUserIdentityAdapter', () => {
  it('should_parse_the_uid_from_getent_passwd_via_argv_only', async () => {
    const identityRunner = new RecordingRunner();
    identityRunner.on('getent', {
      stdout: 'alice:x:1001:1001::/home/alice:/bin/bash\n',
    });
    const identity = new GetentUserIdentityAdapter(identityRunner);

    expect(await identity.uidOf(Username.parse('alice'))).toBe(1001);
    expect(identityRunner.calls[0]?.command).toBe('getent');
    expect(identityRunner.calls[0]?.args).toEqual(['passwd', 'alice']);
  });

  it('should_return_undefined_for_a_missing_account', async () => {
    const identityRunner = new RecordingRunner();
    identityRunner.on('getent', { exitCode: 2 });
    const identity = new GetentUserIdentityAdapter(identityRunner);

    expect(await identity.uidOf(Username.parse('ghost'))).toBeUndefined();
  });
});
