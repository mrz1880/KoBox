import { execFile, execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpsServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigDocument } from '../../src/domain/installation/ConfigDocument.js';

// The Phase 4 product: a fresh Debian 12 container becomes a full KoBox box
// through bootstrap/install.sh alone, then `create user -> everything works`
// through the INSTALLED systemd worker (not --once). apt talks to the real
// mirrors (the sanctioned network path); the ruTorrent artifact comes from a
// local https fixture — no other outbound traffic.

const onDebianAsRoot =
  process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/.dockerenv');

const execFileAsync = promisify(execFile);
const CLI = 'dist/interfaces/cli/main.js';
const USER = 'inste2e';
const FIXTURE_IP = '127.0.0.2';
const ARTIFACT_HOST = 'lists.example.net';
const ARTIFACT_PORT = 8446;
const INSTALL_TIMEOUT_MS = 900_000;
// marker secret: must reach the root worker's env and NEVER the portal's
const PORTAL_FORBIDDEN_SECRET = 'worker-only-secret-marker';

let env: NodeJS.ProcessEnv;
let fixtureDir: string;
let artifactServer: Server | undefined;
let artifactSha = '';

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
}

function isActive(unit: string): boolean {
  try {
    return sh('systemctl', ['is-active', unit], { stdio: 'pipe' }).trim() === 'active';
  } catch {
    return false;
  }
}

function isEnabled(unit: string): boolean {
  try {
    return sh('systemctl', ['is-enabled', unit], { stdio: 'pipe' }).trim() === 'enabled';
  } catch {
    return false;
  }
}

function userExists(): boolean {
  try {
    sh('id', ['-u', USER], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(what: string, check: () => boolean, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function generateCert(cn: string): { key: Buffer; cert: Buffer; pemPath: string } {
  const keyPath = join(fixtureDir, `${cn}.key`);
  const pemPath = join(fixtureDir, `${cn}.pem`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', pemPath, '-days', '30',
    '-subj', `/CN=${cn}`, '-addext', `subjectAltName=DNS:${cn}`,
  ], { stdio: 'ignore' });
  return { key: readFileSync(keyPath), cert: readFileSync(pemPath), pemPath };
}

function buildArtifactTarball(): Buffer {
  const src = join(fixtureDir, 'rutorrent-src');
  mkdirSync(join(src, 'conf'), { recursive: true });
  writeFileSync(join(src, 'index.html'), '<html>ruTorrent fixture</html>\n');
  writeFileSync(join(src, 'conf/.keep'), '');
  const tarPath = join(fixtureDir, 'rutorrent.tar.gz');
  execFileSync('tar', ['-czf', tarPath, '-C', fixtureDir, 'rutorrent-src']);
  return readFileSync(tarPath);
}

describe.skipIf(!onDebianAsRoot)('E2E: fresh Debian 12 -> bootstrap -> full stack', () => {
  beforeAll(async () => {
    // NOT under /tmp: the portal unit runs ProtectSystem=strict, whose only
    // writable path is /var/lib/kobox. A unique subdir of it keeps this suite
    // isolated from the others (a shared /var/lib/kobox/kobox.db would carry
    // another suite's state in here) while staying writable for the portal.
    mkdirSync('/var/lib/kobox', { recursive: true });
    const dir = mkdtempSync('/var/lib/kobox/e2e-install-');
    fixtureDir = mkdtempSync(join(tmpdir(), 'kobox-install-fixtures-'));
    execFileSync('bash', ['docker/e2e-setup.sh']);

    const tarball = buildArtifactTarball();
    artifactSha = createHash('sha256').update(tarball).digest('hex');
    const tls = generateCert(ARTIFACT_HOST);
    artifactServer = createHttpsServer({ key: tls.key, cert: tls.cert }, (request, response) => {
      if (request.url === '/rutorrent.tar.gz') {
        response.writeHead(200);
        response.end(tarball);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => artifactServer?.listen(ARTIFACT_PORT, FIXTURE_IP, resolve));

    env = {
      ...process.env,
      KOBOX_DB: join(dir, 'kobox.db'),
      KOBOX_SPOOL: join(dir, 'events'),
      KOBOX_BIN: `/usr/bin/env node ${process.cwd()}/${CLI}`,
      KOBOX_STRICT_SERVICES: '1',
      KOBOX_VPN_REMOTE: 'seedbox.example.org',
      KOBOX_RUTORRENT_URL: `https://${ARTIFACT_HOST}:${String(ARTIFACT_PORT)}/rutorrent.tar.gz`,
      KOBOX_RUTORRENT_SHA256: artifactSha,
      // a worker-only secret, to prove the non-root portal never receives it
      KOBOX_ALLDEBRID_APIKEY: PORTAL_FORBIDDEN_SECRET,
      NODE_EXTRA_CA_CERTS: tls.pemPath,
    };

    // leftovers from earlier runs must not shadow this one
    try {
      execFileSync('systemctl', ['disable', '--now', `rtorrent-${USER}`], { stdio: 'ignore' });
    } catch { /* absent */ }
    try {
      execFileSync('userdel', ['-r', USER], { stdio: 'ignore' });
    } catch { /* absent */ }
    rmSync('/var/www/rutorrent', { recursive: true, force: true });
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (artifactServer) {
        artifactServer.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
    // the container is shared with the other E2E suites: put the Phase 3
    // rules back (fail2ban off, permissive tables) and drop test residue
    for (const unit of ['kobox-worker', 'kobox-firewall', 'fail2ban', `rtorrent-${USER}`]) {
      try {
        execFileSync('systemctl', ['disable', '--now', unit], { stdio: 'ignore' });
      } catch { /* absent */ }
    }
    try {
      execFileSync('userdel', ['-r', USER], { stdio: 'ignore' });
    } catch { /* absent */ }
    // filter only: the nat table is Docker's (embedded DNS DNAT) — flushing
    // it cuts the container's DNS for every later suite
    for (const args of [
      ['-P', 'INPUT', 'ACCEPT'], ['-P', 'FORWARD', 'ACCEPT'], ['-F'], ['-X'],
    ]) {
      try {
        execFileSync('iptables', args, { stdio: 'ignore' });
      } catch { /* table may be empty */ }
    }
  });

  it(
    'should_install_the_whole_stack_from_the_bootstrap_script',
    async () => {
      // async execFile: the artifact fixture server lives in THIS process
      // (an execFileSync would freeze its TLS handshakes — Phase 2 trap)
      const { stdout } = await execFileAsync(
        'bash',
        ['bootstrap/install.sh', '--allow-non-ext4'],
        { env: { ...env, KOBOX_SRC: process.cwd() }, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      );

      expect(stdout).toContain('kobox-core: installed');

      const status = JSON.parse(kobox(['install-status'])) as {
        name: string;
        state: string;
        reason: string | null;
      }[];
      const byName = new Map(status.map((row) => [row.name, row]));
      for (const name of [
        'kobox-core', 'sshd', 'tweaks', 'quota', 'nginx', 'rtorrent', 'rutorrent',
        'bind', 'fail2ban', 'openvpn', 'postfix', 'scheduler',
      ]) {
        expect(byName.get(name)?.state, name).toBe('installed');
      }
      // pgl is retired (Phase 5): no registry row at all
      expect(byName.has('pgl')).toBe(false);
      // the Debian 12 packaging reality, honestly recorded
      expect(byName.get('dnscrypt')?.state).toBe('skipped');
      expect(byName.get('dnscrypt')?.reason).toContain('not packaged');
      expect(byName.get('apt-sources')?.state).toBe('skipped'); // flag not passed
    },
    INSTALL_TIMEOUT_MS,
  );

  it('should_leave_the_expected_units_running_and_configs_valid', () => {
    for (const unit of ['nginx', 'named', 'postfix', 'kobox-worker']) {
      expect(isActive(unit), unit).toBe(true);
    }
    // Phase 6: the portal is part of the installed stack
    expect(isEnabled('kobox-portal')).toBe(true);
    // bind resolves directly (dnscrypt is not packaged for Debian 12)
    expect(sh('named-checkconf', [])).toBe('');
    expect(isEnabled('kobox-firewall')).toBe(true);
    expect(isEnabled('fail2ban')).toBe(true);
    sh('sshd', ['-t']);
    sh('fail2ban-client', ['-t'], { stdio: 'pipe' });

    // This suite runs on a /tmp DB (0700 root) the non-root portal cannot
    // reach; a real install lives under /var/lib/kobox (setgid 2770
    // root:kobox-portal). Reproduce those perms so the portal can boot, then
    // prove the whole nginx auth_request -> portal chain denies /ru.
    const dbDir = dirname(env.KOBOX_DB ?? '');
    execFileSync('chmod', ['0711', dbDir]);
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${env.KOBOX_DB ?? ''}${suffix}`;
      if (existsSync(path)) {
        execFileSync('chgrp', ['kobox-portal', path]);
        execFileSync('chmod', ['0660', path]);
      }
    }
    sh('systemctl', ['restart', 'kobox-portal']);
    let code = '000';
    for (let i = 0; i < 50; i += 1) {
      code = sh('curl', ['-ks', '-o', '/dev/null', '-w', '%{http_code}',
        'https://127.0.0.1:8189/ru/']).trim();
      if (code === '401') {
        break;
      }
      execFileSync('sleep', ['0.2']);
    }
    // /ru is now gated by the portal session (auth_request), not Basic Auth
    expect(code).toBe('401');

    // least privilege, proven on the RUNNING process: the root worker holds the
    // secret, the non-root portal's own env file and /proc/<pid>/environ do not
    expect(readFileSync('/etc/kobox/worker.env', 'utf8')).toContain(PORTAL_FORBIDDEN_SECRET);
    expect(readFileSync('/etc/kobox/portal.env', 'utf8')).not.toContain(PORTAL_FORBIDDEN_SECRET);
    const portalPid = sh('systemctl', ['show', '-p', 'MainPID', '--value', 'kobox-portal']).trim();
    expect(Number(portalPid)).toBeGreaterThan(0);
    const portalEnviron = readFileSync(`/proc/${portalPid}/environ`, 'utf8');
    expect(portalEnviron).not.toContain(PORTAL_FORBIDDEN_SECRET);
    // …while still getting the plain config it needs to run
    expect(portalEnviron).toContain('KOBOX_DB=');
    // vendored app landed from the verified fixture artifact
    expect(readFileSync('/var/www/rutorrent/index.html', 'utf8')).toContain('ruTorrent fixture');
  });

  it('should_have_converged_the_phase_1_3_desired_state_in_strict_mode', () => {
    // firewall: applied AND persisted (the Phase 3 debt)
    expect(existsSync('/etc/kobox/firewall.rules')).toBe(true);
    expect(sh('iptables-save', [])).toContain(':kobox-meter-out');
    // fail2ban jails incl. the publickey-flood filter
    expect(existsSync('/etc/fail2ban/jail.d/kobox.local')).toBe(true);
    expect(existsSync('/etc/fail2ban/filter.d/kobox-publickey-flood.conf')).toBe(true);
    // EC PKI bootstrapped, servers rendered with dh none and zero compression
    expect(existsSync('/etc/openvpn/kobox-pki/ca.crt')).toBe(true);
    expect(existsSync('/etc/openvpn/kobox-pki/issued/server.crt')).toBe(true);
    for (const variant of ['tun-gw', 'tun', 'tap']) {
      const conf = readFileSync(`/etc/openvpn/server/kobox-${variant}.conf`, 'utf8');
      expect(conf).toContain('dh none');
      expect(conf).not.toContain('comp-lzo');
    }
  });

  it(
    'should_create_a_user_end_to_end_through_the_installed_systemd_worker',
    async () => {
      kobox(['create-user', USER, '--email', `${USER}@example.org`, '--quota-gib', '10'], 's3cretpw\n');

      // no --once drain here: the INSTALLED worker service does the work
      await waitFor('account creation', () => userExists());
      await waitFor('rtorrent instance', () => isActive(`rtorrent-${USER}`));
      await waitFor('vpn client profile', () =>
        existsSync(`/etc/kobox/vpn-profiles/${USER}/kobox-tun-gw.ovpn`),
      );
      const profile = readFileSync(`/etc/kobox/vpn-profiles/${USER}/kobox-tun-gw.ovpn`, 'utf8');
      expect(profile).toContain('remote seedbox.example.org 8193');
      expect(profile).toContain('BEGIN CERTIFICATE');
    },
    240_000,
  );

  it('should_have_installed_what_carries_a_download_to_a_members_own_machine', () => {
    // rsync and sshpass are not decoration: without them the transfer adapter
    // fails at spawn, and the member is told the test could not run. They come
    // with the rtorrent component, and only a real install proves it.
    for (const binary of ['rsync', 'sshpass']) {
      expect(() => sh('dpkg', ['-s', binary], { stdio: 'pipe' }), binary).not.toThrow();
    }
  });

  it('should_let_the_unprivileged_portal_read_every_catalogued_config_it_wrote', () => {
    // The config screen reads these files directly as kobox-portal — no job, no
    // root. That only holds if every catalogued file is world-readable, which
    // is a property of the INSTALLER's chmod, not of the reader. A file that
    // installs 0640 would show as "not on this box" and quietly lie.
    for (const document of ConfigDocument.all()) {
      if (!existsSync(document.path)) {
        continue; // component not installed in this suite: an honest skip
      }
      expect(() =>
        sh('runuser', ['-u', 'kobox-portal', '--', 'cat', document.path], { stdio: 'pipe' }),
        document.path,
      ).not.toThrow();
    }
  });

  it('should_keep_the_secret_bearing_files_out_of_reach_of_that_same_portal', () => {
    // the other half of the argument: the files deliberately absent from the
    // catalog are also unreadable to the process that renders it
    for (const secret of ['/etc/kobox/worker.env', '/etc/kobox/aria2.conf']) {
      if (!existsSync(secret)) {
        continue;
      }
      expect(
        () => sh('runuser', ['-u', 'kobox-portal', '--', 'cat', secret], { stdio: 'pipe' }),
        secret,
      ).toThrow();
    }
  });

  it('should_restore_the_firewall_at_boot_via_the_oneshot_unit', async () => {
    sh('iptables', ['-F', 'INPUT']);
    expect(sh('iptables-save', [])).not.toContain('--dport 22');

    sh('systemctl', ['restart', 'kobox-firewall']);

    const restored = sh('iptables-save', []);
    expect(restored).toContain(':kobox-meter-out');
    expect(restored).toContain(`kobox-u-${USER}`);

    // the masquerade lives in the SHARED nat table (never restored
    // wholesale): the worker service reconverges it on startup — the other
    // half of boot survival
    const masqueradeArgs = [
      '-t', 'nat', '-C', 'POSTROUTING',
      '-s', '10.0.0.0/24', '!', '-d', '10.0.0.0/24', '-j', 'MASQUERADE',
    ];
    sh('iptables', ['-t', 'nat', '-D', 'POSTROUTING',
      '-s', '10.0.0.0/24', '!', '-d', '10.0.0.0/24', '-j', 'MASQUERADE']);
    sh('systemctl', ['restart', 'kobox-worker']);
    await waitFor('masquerade reconvergence', () => {
      try {
        sh('iptables', masqueradeArgs, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }, 60_000);
  });

  it(
    'should_be_idempotent_on_re_run',
    async () => {
      const { stdout } = await execFileAsync('node', [CLI, 'install', '--allow-non-ext4'], {
        env,
        timeout: INSTALL_TIMEOUT_MS,
      });
      const report = JSON.parse(stdout.slice(stdout.indexOf('{'))) as {
        installed: string[];
        alreadyInstalled: string[];
      };
      expect(report.installed).toEqual([]);
      // the whole catalog converged: every component is either already
      // installed or honestly skipped (dnscrypt, apt-sources, and ipset on
      // kernels without ip_set)
      const status = JSON.parse(kobox(['install-status'])) as { state: string }[];
      const skipped = status.filter((row) => row.state === 'skipped').length;
      expect(report.alreadyInstalled.length + skipped).toBe(status.length);
      expect(report.alreadyInstalled.length).toBeGreaterThanOrEqual(12);
    },
    INSTALL_TIMEOUT_MS,
  );

  it('should_install_the_command_its_own_cron_entries_call', () => {
    // Every scheduled job on a real box invoked /usr/local/bin/kobox and
    // nothing created it, so all of them silently did nothing: no mail flush,
    // no blocklist update, no backup, no certificate renewal, no debrid poll.
    //
    // The assertion is about the command the cron file NAMES, not about a
    // fixed path: this suite points KOBOX_BIN at a command of its own, and an
    // assertion on the default path would only be testing that override. What
    // production lacked was an entry pointing at something that exists.
    const command = readFileSync('/etc/cron.d/kobox', 'utf8')
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#') && !/^[A-Z]+=/.test(line))
      .map((line) => line.split(' ')[6])
      .find((c) => c !== undefined);

    expect(command).toBeDefined();
    expect(existsSync(command ?? '')).toBe(true);
    expect(sh(command ?? '', ['--help']).length).toBeGreaterThan(0);
  }, 30_000);

  it('should_uninstall_reversibly_without_touching_user_data', () => {
    const output = kobox(['uninstall', '--yes']);
    expect(output).toContain('kobox-core');

    expect(existsSync('/etc/systemd/system/kobox-worker.service')).toBe(false);
    expect(existsSync('/etc/systemd/system/kobox-firewall.service')).toBe(false);
    expect(isActive('kobox-worker')).toBe(false);
    // the anti-CleanAll contract: the user, their home and the DB survive
    expect(userExists()).toBe(true);
    expect(existsSync(`/home/${USER}`)).toBe(true);
    expect(existsSync(env.KOBOX_DB ?? '')).toBe(true);
    sh('sshd', ['-t']); // stock sshd config still valid after drop-in removal

    const status = JSON.parse(kobox(['install-status'])) as { name: string; state: string }[];
    // nanomon is unpinned in this suite (no KOBOX_NANOMON_URL) so it honestly
    // skips; its real install/uninstall is component-tested and its runtime is
    // covered by nanomon.e2e.
    // aria2 is likewise unpinned here (no KOBOX_ARIA2_RPC_SECRET) so it skips;
    // its install is component-tested.
    const skippedOnDebian12 = [
      'dnscrypt',
      'apt-sources',
      'ipset',
      'letsencrypt',
      'nanomon',
      'aria2',
      'speedtest',
      // unpinned here like nanomon and aria2: no KOBOX_NEXTCLOUD_URL in this
      // suite, so it skips honestly and never reaches to_install
      'nextcloud',
    ];
    for (const row of status) {
      if (!skippedOnDebian12.includes(row.name)) {
        expect(row.state, row.name).toBe('to_install');
      }
    }
  }, 60_000); // two full-stack CLI spawns (uninstall + install-status): the 5s default is too tight
});
