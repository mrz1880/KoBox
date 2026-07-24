import { execFile, execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 3 E2E on a fresh Debian 12: the user-h scenario end-to-end. A real
// default-deny firewall applies WITHOUT locking us out, a DynDNS change
// refreshes whitelist + firewall + fail2ban together, a valid-key SSH flood
// (invisible to stock fail2ban) walks the graduated ladder: ntfy alert ->
// real tc/HTB throttle -> recovery. Suspension stays a manual act.
// No outbound network: DNS via /etc/hosts, ntfy via a local fixture.

const onDebianAsRoot =
  process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/.dockerenv');
const USER = 'e2esec';
const CLI = 'dist/interfaces/cli/main.js';
const WORKER = 'dist/interfaces/worker/main.js';
const DYN_HOST = 'dyn.example.org';
const NTFY_HOST = 'ntfy.example.net';
const NTFY_PORT = 8446;
const FIXTURE_IP = '127.0.0.2';
const CHANGED_IP = '127.0.0.4';
const RULES_PATH = '/etc/kobox/firewall.rules';
const JAIL_PATH = '/etc/fail2ban/jail.d/kobox.local';
const ALLOW_P2P = '/etc/pgl/allow.p2p';

let env: NodeJS.ProcessEnv;
let dbPath: string;
let pkiDir: string;
let originalIptables = '';
let originalHosts = '';
let ntfyServer: Server | undefined;
const ntfyReceived: { title: string; body: string }[] = [];

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
}

const execFileAsync = promisify(execFile);

// async: this process hosts the ntfy fixture — a sync exec would freeze the
// event loop and the worker's alert POSTs with it (Phase 2 lesson)
async function drainQueue(): Promise<void> {
  await execFileAsync('node', [WORKER, '--once'], { encoding: 'utf8', env });
}

function dbRow(query: string, ...params: string[]): Record<string, unknown> | undefined {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(query).get(...params) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

function dbAll(query: string, ...params: string[]): Record<string, unknown>[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(query).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

function uidOf(user: string): number {
  return Number(sh('id', ['-u', user]).trim());
}

function setHostsEntry(host: string, ip: string): void {
  const cleaned = readFileSync('/etc/hosts', 'utf8')
    .split('\n')
    .filter((line) => !line.includes(host))
    .join('\n');
  writeFileSync('/etc/hosts', `${cleaned.trimEnd()}\n${ip} ${host}\n`);
}

function floodJournal(count: number): void {
  for (let i = 0; i < count; i += 1) {
    execFileSync('systemd-cat', ['-t', 'sshd'], {
      input: `Accepted publickey for ${USER} from 203.0.113.55 port ${String(50000 + i)} ssh2: RSA SHA256:e2efixture`,
    });
  }
  execFileSync('journalctl', ['--sync']);
}

function wipeJournalWindow(): void {
  execFileSync('journalctl', ['--rotate']);
  execFileSync('journalctl', ['--vacuum-time=1s'], { stdio: 'ignore' });
}

describe.skipIf(!onDebianAsRoot)('E2E: security & network — the user-h slice', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-security-e2e-'));
    dbPath = join(dir, 'kobox.db');
    pkiDir = join(dir, 'pki');
    originalIptables = execFileSync('iptables-save', { encoding: 'utf8' });
    originalHosts = readFileSync('/etc/hosts', 'utf8');

    sh('bash', ['docker/e2e-setup.sh'], { env: process.env });
    setHostsEntry(DYN_HOST, FIXTURE_IP);
    sh('systemctl', ['start', 'ssh']); // the lifeline the guard probes

    // fixture PKI tree (easy-rsa shape) for the client profile render
    mkdirSync(join(pkiDir, 'issued'), { recursive: true });
    mkdirSync(join(pkiDir, 'private'), { recursive: true });
    writeFileSync(join(pkiDir, 'ca.crt'), '-----BEGIN CERTIFICATE-----\nE2E-CA\n-----END CERTIFICATE-----\n');
    writeFileSync(join(pkiDir, `issued/${USER}.crt`), '-----BEGIN CERTIFICATE-----\nE2E-USER\n-----END CERTIFICATE-----\n');
    writeFileSync(join(pkiDir, `private/${USER}.key`), '-----BEGIN PRIVATE KEY-----\nE2E-KEY\n-----END PRIVATE KEY-----\n');

    ntfyServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        ntfyReceived.push({
          title: String(request.headers.title ?? ''),
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200);
        response.end();
      });
    });
    await new Promise<void>((resolve) => ntfyServer?.listen(NTFY_PORT, FIXTURE_IP, resolve));

    env = {
      ...process.env,
      KOBOX_DB: dbPath,
      KOBOX_SPOOL: join(dir, 'events'),
      KOBOX_BIN: `/usr/bin/env node ${process.cwd()}/${CLI}`,
      KOBOX_NTFY_URL: `http://${NTFY_HOST}:${String(NTFY_PORT)}/kobox`,
      KOBOX_WAN_IF: 'eth0',
      KOBOX_VPN_PKI: pkiDir,
      KOBOX_VPN_REMOTE: DYN_HOST,
    };

    for (const path of [RULES_PATH, JAIL_PATH, ALLOW_P2P]) {
      rmSync(path, { force: true });
    }
    wipeJournalWindow(); // older suites may have logged Accepted publickey lines
    try {
      execFileSync('systemctl', ['disable', '--now', `rtorrent-${USER}`], { stdio: 'ignore' });
    } catch {
      // unit may not exist yet
    }
    try {
      execFileSync('userdel', ['-r', USER], { stdio: 'ignore' });
    } catch {
      // user may not exist yet
    }
  }, 60_000);

  afterAll(async () => {
    try {
      const uid = uidOf(USER);
      execFileSync('tc', ['qdisc', 'del', 'dev', 'eth0', 'root'], { stdio: 'ignore' });
      execFileSync(
        'iptables',
        ['-t', 'mangle', '-D', 'OUTPUT', '-m', 'owner', '--uid-owner', String(uid), '-j', 'MARK', '--set-mark', String(uid)],
        { stdio: 'ignore' },
      );
    } catch {
      // nothing throttled
    }
    execFileSync('iptables-restore', { input: originalIptables });
    writeFileSync('/etc/hosts', originalHosts);
    // leave no unit behind: a live rtorrent-e2esec would squat SCGI 51101
    // and crash-loop every later suite's instance
    try {
      execFileSync('systemctl', ['disable', '--now', `rtorrent-${USER}`], { stdio: 'ignore' });
    } catch {
      // unit may be gone already
    }
    try {
      execFileSync('userdel', ['-r', USER], { stdio: 'ignore' });
    } catch {
      // user may be gone already
    }
    await new Promise<void>((resolve) => {
      ntfyServer?.close(() => {
        resolve();
      });
    });
  }, 60_000);

  it('should_apply_default_deny_without_locking_us_out_when_a_user_is_created', async () => {
    kobox(['create-user', USER, '--email', 'e2e@example.org', '--quota-gib', '5'], 'pw123456\n');
    await drainQueue(); // create -> provision -> filters + apply-firewall chain

    const live = execFileSync('iptables-save', { encoding: 'utf8' });
    expect(live).toContain(':INPUT DROP');
    expect(live).toContain('-A INPUT -i lo -j ACCEPT');
    expect(live).toContain('--dport 22 -j ACCEPT'); // the lifeline held: we are still here
    expect(live).toContain(`kobox-u-${USER}`);
    expect(live).toContain(`--uid-owner ${String(uidOf(USER))}`);
    expect(readFileSync(RULES_PATH, 'utf8')).toContain(`kobox-u-${USER}`);

    // idempotence: a second reconcile changes nothing
    const before = readFileSync(RULES_PATH, 'utf8');
    kobox(['apply-firewall']);
    await drainQueue();
    expect(readFileSync(RULES_PATH, 'utf8')).toBe(before);
  }, 120_000);

  it('should_refresh_whitelist_firewall_and_fail2ban_when_the_dyndns_ip_changes', async () => {
    kobox(['add-user-hostname', USER, DYN_HOST]);
    kobox(['resolve-dyndns']);
    await drainQueue(); // resolve + chained render-whitelist/apply-firewall/render-fail2ban

    expect(readFileSync(ALLOW_P2P, 'utf8')).toContain(`${USER}:${FIXTURE_IP}`);
    expect(readFileSync(JAIL_PATH, 'utf8')).toContain(FIXTURE_IP);
    expect(readFileSync(RULES_PATH, 'utf8')).toContain(
      `-A INPUT -s ${FIXTURE_IP} -m comment --comment "kobox:trusted:${USER}" -j ACCEPT`,
    );

    // the home IP moves (the DynamicAddressResolver replacement at work)
    setHostsEntry(DYN_HOST, CHANGED_IP);
    kobox(['resolve-dyndns']);
    await drainQueue();

    expect(readFileSync(ALLOW_P2P, 'utf8')).toContain(`${USER}:${CHANGED_IP}`);
    expect(readFileSync(ALLOW_P2P, 'utf8')).not.toContain(`${USER}:${FIXTURE_IP}`);
    expect(readFileSync(JAIL_PATH, 'utf8')).toContain(CHANGED_IP);
    expect(readFileSync(RULES_PATH, 'utf8')).toContain(`-A INPUT -s ${CHANGED_IP}`);
    const row = dbRow('SELECT * FROM user_addresses WHERE check_by = ?', 'hostname');
    expect(row?.hostname).toBe(DYN_HOST);
    expect(row?.ipv4).toBe(CHANGED_IP);
  }, 120_000);

  it('should_render_fail2ban_config_a_real_fail2ban_accepts', () => {
    expect(readFileSync(JAIL_PATH, 'utf8')).toContain('[kobox-publickey-flood]');
    execFileSync('fail2ban-client', ['-t'], { stdio: 'ignore' });
  }, 60_000);

  it('should_walk_the_graduated_ladder_on_a_valid_key_ssh_flood', async () => {
    // the user-h vector: valid publickey logins no stock jail can see
    floodJournal(40); // > 30/h budget

    kobox(['evaluate-fair-use']);
    await drainQueue();
    expect(dbRow('SELECT * FROM fair_use_state WHERE username = ?', USER)?.level).toBe('alerted');
    const alert = ntfyReceived.at(-1);
    expect(alert?.title).toContain('abnormal SSH auth rate');
    expect(alert?.body).toContain(USER);

    // still flooding -> the throttle engages for real
    kobox(['evaluate-fair-use']);
    await drainQueue();
    expect(dbRow('SELECT * FROM fair_use_state WHERE username = ?', USER)?.level).toBe('throttled');
    const uidHex = uidOf(USER).toString(16);
    expect(sh('tc', ['class', 'show', 'dev', 'eth0'])).toContain(`1:${uidHex}`);
    expect(ntfyReceived.at(-1)?.title).toContain('auto-throttled');

    // calm again -> recovery lifts the throttle
    wipeJournalWindow();
    kobox(['evaluate-fair-use']);
    await drainQueue();
    expect(dbRow('SELECT * FROM fair_use_state WHERE username = ?', USER)?.level).toBe('none');
    expect(sh('tc', ['class', 'show', 'dev', 'eth0'])).not.toContain(`1:${uidHex}`);
    expect(ntfyReceived.at(-1)?.title).toContain('back within fair use');

    // every rung is on the audit trail
    const audit = dbAll(
      'SELECT event_type FROM fair_use_events WHERE username = ? ORDER BY id',
      USER,
    ).map((row) => row.event_type);
    expect(audit).toEqual(['AbnormalAuthRate', 'UserThrottled', 'FairUseRecovered']);
  }, 120_000);

  it('should_keep_suspension_manual_and_working_under_the_active_firewall', async () => {
    kobox(['suspend-user', USER]);
    await drainQueue();
    expect(dbRow('SELECT status FROM users WHERE username = ?', USER)?.status).toBe('suspended');
    expect(sh('passwd', ['-S', USER])).toContain(' L '); // account locked

    kobox(['resume-user', USER]);
    await drainQueue();
    expect(dbRow('SELECT status FROM users WHERE username = ?', USER)?.status).toBe('active');
  }, 120_000);

  it('should_render_openvpn_servers_and_client_profiles_without_compression', async () => {
    kobox(['render-openvpn']);
    await drainQueue();

    for (const variant of ['tun-gw', 'tun', 'tap']) {
      const conf = readFileSync(`/etc/openvpn/server/kobox-${variant}.conf`, 'utf8');
      expect(conf).not.toContain('comp-lzo');
      expect(conf).toContain('data-ciphers AES-256-GCM');
    }
    const profile = readFileSync(`/etc/kobox/vpn-profiles/${USER}/kobox-tun-gw.ovpn`, 'utf8');
    expect(profile).toContain(`remote ${DYN_HOST} 8193`);
    expect(profile).toContain('E2E-USER');
    expect(profile).not.toContain('comp-lzo');
  }, 60_000);
});
