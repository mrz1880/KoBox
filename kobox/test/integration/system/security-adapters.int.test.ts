import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Bandwidth } from '../../../src/domain/security/Bandwidth.js';
import { Cidr } from '../../../src/domain/security/Cidr.js';
import { FirewallPolicy } from '../../../src/domain/security/FirewallPolicy.js';
import { renderFail2banJails, renderFirewallRules, renderPortalLoginFilter, renderPublickeyFloodFilter } from '../../../src/domain/security/rendering.js';
import type { HealthCheckResult, HealthProbePort } from '../../../src/domain/user/ports.js';
import { Username } from '../../../src/domain/user/Username.js';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';
import { IptablesRestoreAdapter } from '../../../src/infrastructure/system/IptablesRestoreAdapter.js';
import { IptablesUsageMeterAdapter } from '../../../src/infrastructure/system/IptablesUsageMeterAdapter.js';
import { JournaldSshAuthAdapter } from '../../../src/infrastructure/system/JournaldSshAuthAdapter.js';
import { ProcessSocketHealthProbe } from '../../../src/infrastructure/system/ProcessSocketHealthProbe.js';
import { RtorrentConfigAdapter } from '../../../src/infrastructure/system/RtorrentConfigAdapter.js';
import { TcShapingAdapter } from '../../../src/infrastructure/system/TcShapingAdapter.js';

// Firewall/tc mutations are confined to the privileged dev container — never
// a bare root Linux host (a CI runner outside Docker must not lose its INPUT
// policy for even a second).
const inContainerAsRoot =
  process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/.dockerenv');

const runner = new ExecFileRunner();
const SSH_PROBE_PORT = 42222;

const settings = {
  sshPort: SSH_PROBE_PORT,
  portalPort: 8189,
  blocklistSet: false,
  vpn: {
    tunGwPort: 8193,
    tunPort: 8194,
    tapPort: 8195,
    tunGwSubnet: Cidr.parse('10.0.0.0/24'),
    tunSubnet: Cidr.parse('10.0.1.0/24'),
    tapSubnet: Cidr.parse('10.0.2.0/24'),
  },
} as const;

function testPolicy(): FirewallPolicy {
  return FirewallPolicy.create({
    ...settings,
    users: [
      {
        username: Username.parse('kbxsecuser'),
        uid: 44201,
        rtorrentPort: 46001,
        addresses: [],
      },
    ],
  });
}

class FailingProbe implements HealthProbePort {
  checkProcess(name: string): Promise<HealthCheckResult> {
    return Promise.resolve({ name, state: 'unhealthy' });
  }

  checkSocket(host: string, port: number): Promise<HealthCheckResult> {
    return Promise.resolve({ name: `${host}:${String(port)}`, state: 'unhealthy' });
  }
}

describe.skipIf(!inContainerAsRoot)('security adapters against the real container', () => {
  let lifeline: Server;
  let originalRules = '';
  const RULES_PATH = '/etc/kobox/firewall.rules';

  beforeAll(async () => {
    originalRules = execFileSync('iptables-save', { encoding: 'utf8' });
    lifeline = createServer();
    await new Promise<void>((resolve) => {
      lifeline.listen(SSH_PROBE_PORT, '127.0.0.1', resolve);
    });
  });

  afterAll(async () => {
    execFileSync('iptables-restore', { input: originalRules });
    execFileSync('rm', ['-f', RULES_PATH]);
    try {
      execFileSync('ip', ['link', 'del', 'kbxdum0'], { stdio: 'ignore' });
    } catch {
      // link only exists when the tc test ran
    }
    await new Promise<void>((resolve) => {
      lifeline.close(() => {
        resolve();
      });
    });
  });

  it('should_apply_the_rendered_policy_atomically_and_idempotently', async () => {
    const adapter = new IptablesRestoreAdapter(
      runner,
      new RtorrentConfigAdapter(runner),
      new ProcessSocketHealthProbe(runner),
      SSH_PROBE_PORT,
    );
    const rules = renderFirewallRules(testPolicy());

    expect(await adapter.apply(rules)).toBe('applied');
    const live = execFileSync('iptables-save', { encoding: 'utf8' });
    expect(live).toContain(':INPUT DROP');
    expect(live).toContain('-A INPUT -i lo -j ACCEPT');
    expect(live).toContain('kobox-u-kbxsecuser');
    expect(live).toContain('--uid-owner 44201');

    expect(await adapter.apply(rules)).toBe('unchanged');
  }, 30_000);

  it('should_meter_counters_from_the_live_chains', async () => {
    const meter = new IptablesUsageMeterAdapter(runner);
    const counters = await meter.readCounters();
    const user = counters.find((counter) => counter.username === 'kbxsecuser');
    expect(user).toBeDefined();
    expect(user?.egressBytes).toBeGreaterThanOrEqual(0);
  });

  it('should_roll_back_to_the_snapshot_when_the_lifeline_probe_fails', async () => {
    const before = execFileSync('iptables-save', { encoding: 'utf8' });
    const adapter = new IptablesRestoreAdapter(
      runner,
      new RtorrentConfigAdapter(runner),
      new FailingProbe(),
      SSH_PROBE_PORT,
    );
    const changed = FirewallPolicy.create({ ...settings, portalPort: 8190, users: [] });

    expect(await adapter.apply(renderFirewallRules(changed))).toBe('rolled-back');

    const after = execFileSync('iptables-save', { encoding: 'utf8' });
    // strip volatile timestamps and packet/byte counters before comparing
    const normalize = (dump: string): string =>
      dump
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .map((line) => line.replace(/\[\d+:\d+\]/g, '[0:0]'))
        .join('\n');
    expect(normalize(after)).toBe(normalize(before));
  }, 30_000);

  it('should_render_fail2ban_files_a_real_fail2ban_accepts', async () => {
    // the stock nginx-http-auth jail wants its logfile to exist; nginx is not
    // installed in the container (it is on the real box), so stub the path —
    // the test owns its precondition rather than leaning on external setup
    mkdirSync('/var/log/nginx', { recursive: true });
    writeFileSync('/var/log/nginx/error.log', '');
    const files = new RtorrentConfigAdapter(runner);
    // render the whole set the jail file references (jail + both filters):
    // the [kobox-portal] jail points at kobox-portal.conf, so -t rejects the
    // config if it is missing
    await files.apply([
      renderFail2banJails([], 22),
      renderPublickeyFloodFilter(),
      renderPortalLoginFilter(),
    ]);

    // exit 0 = full configuration (including the publickey-flood jail) parses
    execFileSync('fail2ban-client', ['-t'], { stdio: 'ignore' });
  }, 30_000);

  it('should_count_fixture_publickey_lines_from_the_real_journal', async () => {
    for (let i = 0; i < 3; i += 1) {
      execFileSync('systemd-cat', ['-t', 'sshd'], {
        input: `Accepted publickey for kbxsecuser from 203.0.113.55 port ${String(51000 + i)} ssh2: RSA SHA256:fixture`,
      });
    }
    // journald flush is asynchronous
    execFileSync('journalctl', ['--sync']);

    const authLog = new JournaldSshAuthAdapter(runner);
    // >= : journal entries from earlier suite runs on the same boot persist
    expect(await authLog.countAcceptedPublickey(Username.parse('kbxsecuser'), 10)).toBeGreaterThanOrEqual(3);
    expect(await authLog.countAcceptedPublickey(Username.parse('kbxother'), 10)).toBe(0);
  }, 30_000);

  it('should_shape_and_unshape_a_dummy_link_with_real_tc', async () => {
    execFileSync('ip', ['link', 'add', 'kbxdum0', 'type', 'dummy']);
    execFileSync('ip', ['link', 'set', 'kbxdum0', 'up']);
    const shaper = new TcShapingAdapter(runner, 'kbxdum0');
    const username = Username.parse('kbxsecuser');

    await shaper.throttle(username, 44201, Bandwidth.mbit(5));
    expect(await shaper.isThrottled(44201)).toBe(true);
    const classes = execFileSync('tc', ['class', 'show', 'dev', 'kbxdum0'], { encoding: 'utf8' });
    expect(classes).toContain('rate 5Mbit');

    await shaper.unthrottle(username, 44201);
    expect(await shaper.isThrottled(44201)).toBe(false);
    const mangle = execFileSync('iptables-save', ['-t', 'mangle'], { encoding: 'utf8' });
    expect(mangle).not.toContain('--uid-owner 44201');
  }, 30_000);
});
