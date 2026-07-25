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
import { Cidr } from '../../../../src/domain/security/Cidr.js';
import { DynDnsHost } from '../../../../src/domain/security/DynDnsHost.js';
import { DynDnsLookupAdapter } from '../../../../src/infrastructure/system/DynDnsLookupAdapter.js';
import { FsVpnPkiAdapter } from '../../../../src/infrastructure/system/FsVpnPkiAdapter.js';
import { GetentUserIdentityAdapter } from '../../../../src/infrastructure/system/GetentUserIdentityAdapter.js';
import { IptablesRestoreAdapter } from '../../../../src/infrastructure/system/IptablesRestoreAdapter.js';
import { IptablesUsageMeterAdapter } from '../../../../src/infrastructure/system/IptablesUsageMeterAdapter.js';
import { JournaldSshAuthAdapter } from '../../../../src/infrastructure/system/JournaldSshAuthAdapter.js';
import { TcShapingAdapter } from '../../../../src/infrastructure/system/TcShapingAdapter.js';
import { Bandwidth } from '../../../../src/domain/security/Bandwidth.js';
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

  it('should_be_idempotent_when_the_persisted_rules_already_match_the_live_tables', async () => {
    await adapter.apply(rules);
    // the live tables carry our sentinel chain — nothing to do
    runner.on('iptables-save', { stdout: '*filter\n:kobox-meter-out - [0:0]\nCOMMIT\n' });
    runner.calls.length = 0;

    const outcome = await adapter.apply(rules);

    expect(outcome).toBe('unchanged');
    expect(runner.calls.map((call) => call.command)).toEqual(['iptables-save']); // probe only
  });

  it('should_reapply_after_a_reboot_wiped_the_live_tables_despite_a_matching_file', async () => {
    // iptables state does not survive reboot; the file alone is not proof
    await adapter.apply(rules);
    runner.calls.length = 0; // live tables still SNAPSHOT (no kobox chains)

    const outcome = await adapter.apply(rules);

    expect(outcome).toBe('applied');
    expect(runner.calls.filter((call) => call.command === 'iptables-restore')).toHaveLength(1);
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

  // nat is shared with Docker: the masquerade is a targeted check-then-add,
  // never part of the restored ruleset
  it('should_ensure_the_masquerade_with_a_targeted_check_then_add', async () => {
    const natRunner = new NatCheckRunner(1); // -C says absent

    await new IptablesRestoreAdapter(natRunner, files, probe, 22).ensureMasquerade(
      Cidr.parse('10.0.0.0/24'),
    );

    expect(natRunner.lines).toEqual([
      'iptables -t nat -C POSTROUTING -s 10.0.0.0/24 ! -d 10.0.0.0/24 -j MASQUERADE',
      'iptables -t nat -A POSTROUTING -s 10.0.0.0/24 ! -d 10.0.0.0/24 -j MASQUERADE',
    ]);
  });

  it('should_not_duplicate_an_existing_masquerade', async () => {
    const natRunner = new NatCheckRunner(0); // -C says present

    await new IptablesRestoreAdapter(natRunner, files, probe, 22).ensureMasquerade(
      Cidr.parse('10.0.0.0/24'),
    );

    expect(natRunner.lines.filter((line) => line.includes(' -A '))).toEqual([]);
  });
});

class NatCheckRunner implements CommandRunner {
  readonly lines: string[] = [];

  constructor(private readonly checkExit: number) {}

  run(request: CommandRequest): Promise<CommandResult> {
    this.lines.push([request.command, ...request.args].join(' '));
    const exitCode = request.args.includes('-C') ? this.checkExit : 0;
    return Promise.resolve({ stdout: '', stderr: '', exitCode });
  }
}

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

    const reloadCalls = runner
      .commandLines()
      .filter((line) => !line.startsWith('systemctl list-unit-files'));
    expect(reloadCalls).toEqual([]);
  });

  it('should_escalate_when_systemctl_itself_fails_rather_than_treat_it_as_absent', async () => {
    // absence is the ONE tolerated case; a dbus failure is not absence
    const runner = new PrefixRunner();
    runner.on('systemctl list-unit-files', {
      exitCode: 1,
      stderr: 'Failed to connect to bus: No such file or directory',
    });
    const adapter = new NetworkServiceAdapter(runner, logger);

    await expect(adapter.reloadFail2ban()).rejects.toThrow('Failed to connect to bus');
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

  it('should_treat_absent_units_as_errors_in_strict_mode', async () => {
    // post-install this path must never be taken (Phase 4 brief): a box that
    // kobox install provisioned HAS fail2ban/bind — absence means breakage
    const runner = new PrefixRunner(); // nothing installed
    const adapter = new NetworkServiceAdapter(runner, logger, {
      strict: true,
      tolerateAbsent: ['dnscrypt-proxy'],
    });

    await expect(adapter.reloadFail2ban()).rejects.toThrow('strict');
    // dnscrypt-proxy is skipped on Debian 12 (not packaged): tolerated even
    // in strict; named alone is still breakage
    await expect(adapter.reloadDns()).rejects.toThrow('strict');
  });
});

const METER_OUT_LISTING = `Chain kobox-meter-out (1 references)
    pkts      bytes target     prot opt in     out     source               destination
     120    654321 RETURN     all  --  *      *       0.0.0.0/0            0.0.0.0/0            owner UID match 1001 /* kobox:egress:alice */
      10     11111 RETURN     all  --  *      *       0.0.0.0/0            0.0.0.0/0            owner UID match 1002 /* kobox:egress:bob */
`;

const METER_IN_LISTING = `Chain kobox-meter-in (2 references)
    pkts      bytes target     prot opt in     out     source               destination
      50     98765 RETURN     tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:45000 /* kobox:ingress:alice */
`;

describe('IptablesUsageMeterAdapter', () => {
  it('should_parse_egress_and_ingress_counters_from_the_meter_chains', async () => {
    const runner = new PrefixRunner();
    runner.on('iptables -nvxL kobox-meter-out', { stdout: METER_OUT_LISTING });
    runner.on('iptables -nvxL kobox-meter-in', { stdout: METER_IN_LISTING });
    const meter = new IptablesUsageMeterAdapter(runner);

    const counters = await meter.readCounters();

    expect(counters).toEqual([
      { username: 'alice', egressBytes: 654_321, ingressBytes: 98_765 },
      { username: 'bob', egressBytes: 11_111, ingressBytes: 0 },
    ]);
  });

  it('should_return_no_counters_on_a_fresh_box_without_the_chains', async () => {
    const runner = new PrefixRunner();
    runner.on('iptables', { exitCode: 1, stderr: 'iptables: No chain/target/match by that name.' });
    const meter = new IptablesUsageMeterAdapter(runner);

    expect(await meter.readCounters()).toEqual([]);
  });
});

const JOURNAL_JSONL = [
  JSON.stringify({ MESSAGE: 'Accepted publickey for alice from 203.0.113.55 port 51234 ssh2' }),
  JSON.stringify({ MESSAGE: 'Accepted publickey for alice from 203.0.113.55 port 51235 ssh2' }),
  JSON.stringify({ MESSAGE: 'Accepted publickey for bob from 198.51.100.9 port 4222 ssh2' }),
  JSON.stringify({ MESSAGE: 'Accepted password for alice from 203.0.113.55 port 51236 ssh2' }),
  JSON.stringify({ MESSAGE: 'Disconnected from user alice 203.0.113.55 port 51234' }),
].join('\n');

describe('JournaldSshAuthAdapter', () => {
  it('should_count_accepted_publickey_lines_for_the_user_only', async () => {
    const runner = new PrefixRunner();
    runner.on('journalctl', { stdout: JOURNAL_JSONL });
    const authLog = new JournaldSshAuthAdapter(runner);

    expect(await authLog.countAcceptedPublickey(Username.parse('alice'), 60)).toBe(2);
    const call = runner.calls[0];
    expect(call?.command).toBe('journalctl');
    expect(call?.args).toContain('--since');
    expect(call?.args).toContain('-60min');
    // match by syslog identifier, not unit: it catches the real sshd AND
    // journal entries emitted by fixtures (systemd-cat -t sshd)
    expect(call?.args).toContain('--identifier');
    expect(call?.args).toContain('sshd');
  });

  it('should_treat_the_no_entries_exit_code_as_zero', async () => {
    // journalctl exits 1 with empty output when nothing matches the window
    const runner = new PrefixRunner();
    runner.on('journalctl', { exitCode: 1, stdout: '' });
    const authLog = new JournaldSshAuthAdapter(runner);

    expect(await authLog.countAcceptedPublickey(Username.parse('alice'), 60)).toBe(0);
  });

  it('should_escalate_a_broken_journald_instead_of_reading_it_as_calm', async () => {
    // a dead journal must not silently blind the user-h detector
    const runner = new PrefixRunner();
    runner.on('journalctl', { exitCode: 2, stderr: 'Failed to open journal: Input/output error' });
    const authLog = new JournaldSshAuthAdapter(runner);

    await expect(authLog.countAcceptedPublickey(Username.parse('alice'), 60)).rejects.toThrow(
      'Input/output error',
    );
  });
});

describe('TcShapingAdapter', () => {
  const alice = Username.parse('alice');

  it('should_refuse_a_uid_that_does_not_fit_a_16_bit_classid', async () => {
    // tc minor ids are 16-bit: a silent wrap would throttle the WRONG user
    const runner = new PrefixRunner();
    const shaper = new TcShapingAdapter(runner, 'eth0');

    await expect(shaper.throttle(alice, 70000, Bandwidth.mbit(5))).rejects.toThrow('65534');
    expect(runner.commandLines()).toEqual([]);
  });

  it('should_create_the_htb_tree_mark_and_filter_on_first_throttle', async () => {
    const runner = new PrefixRunner();
    runner.on('iptables -t mangle -C', { exitCode: 1 }); // mark rule absent
    const shaper = new TcShapingAdapter(runner, 'eth0');

    await shaper.throttle(alice, 1001, Bandwidth.mbit(5));

    expect(runner.commandLines()).toEqual([
      'tc qdisc show dev eth0',
      'tc qdisc add dev eth0 root handle 1: htb',
      'tc class replace dev eth0 parent 1: classid 1:3e9 htb rate 5000kbit',
      'tc filter replace dev eth0 parent 1: protocol ip prio 1 handle 0x3e9 fw flowid 1:3e9',
      'iptables -t mangle -C OUTPUT -m owner --uid-owner 1001 -j MARK --set-mark 1001',
      'iptables -t mangle -A OUTPUT -m owner --uid-owner 1001 -j MARK --set-mark 1001',
    ]);
  });

  it('should_be_idempotent_when_the_qdisc_and_mark_already_exist', async () => {
    const runner = new PrefixRunner();
    runner.on('tc qdisc show', { stdout: 'qdisc htb 1: root refcnt 2\n' });
    runner.on('iptables -t mangle -C', { exitCode: 0 });
    const shaper = new TcShapingAdapter(runner, 'eth0');

    await shaper.throttle(alice, 1001, Bandwidth.mbit(5));

    const lines = runner.commandLines();
    expect(lines).not.toContain('tc qdisc add dev eth0 root handle 1: htb');
    expect(lines.filter((line) => line.startsWith('iptables -t mangle -A'))).toEqual([]);
    // rate updates still go through (replace semantics)
    expect(lines).toContain('tc class replace dev eth0 parent 1: classid 1:3e9 htb rate 5000kbit');
  });

  it('should_tear_down_filter_class_and_mark_on_unthrottle', async () => {
    const runner = new PrefixRunner();
    runner.on('tc class show', { stdout: 'class htb 1:3e9 root prio 0 rate 5Mbit\n' });
    runner.on('iptables -t mangle -C', { exitCode: 0 });
    const shaper = new TcShapingAdapter(runner, 'eth0');

    await shaper.unthrottle(alice, 1001);

    expect(runner.commandLines()).toEqual([
      'tc class show dev eth0',
      'tc filter del dev eth0 parent 1: protocol ip prio 1 handle 0x3e9 fw',
      'tc class del dev eth0 parent 1: classid 1:3e9',
      'iptables -t mangle -C OUTPUT -m owner --uid-owner 1001 -j MARK --set-mark 1001',
      'iptables -t mangle -D OUTPUT -m owner --uid-owner 1001 -j MARK --set-mark 1001',
    ]);
  });

  it('should_do_nothing_on_unthrottle_when_not_throttled', async () => {
    const runner = new PrefixRunner();
    const shaper = new TcShapingAdapter(runner, 'eth0');

    await shaper.unthrottle(alice, 1001);

    expect(runner.commandLines()).toEqual(['tc class show dev eth0']);
  });

  it('should_report_throttled_state_from_the_class_table', async () => {
    const runner = new PrefixRunner();
    runner.on('tc class show', { stdout: 'class htb 1:3e9 root prio 0 rate 5Mbit\n' });
    const shaper = new TcShapingAdapter(runner, 'eth0');

    expect(await shaper.isThrottled(1001)).toBe(true);
    expect(await shaper.isThrottled(1002)).toBe(false);
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
