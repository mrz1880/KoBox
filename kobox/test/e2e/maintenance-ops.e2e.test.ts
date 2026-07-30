import { execFile, execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KoboxDatabase } from '../../src/infrastructure/persistence/db.js';

// The Phase 5 product on an installed box: the declarative scheduler ticks
// typed jobs through the systemd worker, the outbox leaves via the local
// Postfix, backups restore, upgrades stage/flip/rollback without ever
// breaking the running release, and certbot issues against the LOCAL pebble
// fixture (never the public Let's Encrypt).

const onDebianAsRoot =
  process.platform === 'linux' && process.getuid?.() === 0 && existsSync('/.dockerenv');

const execFileAsync = promisify(execFile);
const CLI = 'dist/interfaces/cli/main.js';
const INSTALL_TIMEOUT_MS = 900_000;
const PEBBLE_CA = '/opt/pebble-test/certs/pebble.minica.pem';
const PEBBLE_URL = 'https://pebble:14000/dir';
const LE_DOMAIN = 'box.example.org';
const CURRENT_LINK = '/opt/kobox/current';

let env: NodeJS.ProcessEnv;
let workDir: string;
let backupRoot: string;
let pebbleAvailable = false;
let originalCurrentTarget: string | undefined;

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

function openDb(): KoboxDatabase {
  return KoboxDatabase.open(env.KOBOX_DB ?? '');
}

function jobCounts(): Map<string, { pending: number; failed: number; done: number }> {
  const db = openDb();
  const rows = db.raw
    .prepare('SELECT type, status, COUNT(*) AS n FROM jobs GROUP BY type, status')
    .all() as { type: string; status: string; n: number }[];
  db.close();
  const counts = new Map<string, { pending: number; failed: number; done: number }>();
  for (const row of rows) {
    const entry = counts.get(row.type) ?? { pending: 0, failed: 0, done: 0 };
    if (row.status === 'pending') entry.pending += row.n;
    if (row.status === 'failed') entry.failed += row.n;
    if (row.status === 'done') entry.done += row.n;
    counts.set(row.type, entry);
  }
  return counts;
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

function probePebble(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(PEBBLE_CA)) {
      resolve(false);
      return;
    }
    const request = httpsGet(
      PEBBLE_URL,
      { ca: readFileSync(PEBBLE_CA), timeout: 5_000 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on('error', () => {
      resolve(false);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

// A tiny installable "release": enough package to survive pnpm install,
// pnpm build, `main.js migrate` and a worker main that stays alive. The
// upgrade machinery cannot tell it from a real KoBox build.
function scaffoldFakeRelease(dir: string, marker: string, brokenBuild: boolean): void {
  const pkg = join(dir, 'kobox');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify(
      {
        name: 'kobox-fake-release',
        version: '0.0.1',
        private: true,
        scripts: { build: brokenBuild ? 'node -e "process.exit(2)"' : 'node build.js' },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(pkg, 'build.js'),
    [
      "const { mkdirSync, writeFileSync } = require('node:fs');",
      "mkdirSync('dist/interfaces/cli', { recursive: true });",
      "mkdirSync('dist/interfaces/worker', { recursive: true });",
      `writeFileSync('dist/interfaces/cli/main.js', 'process.exit(0);');`,
      `writeFileSync('dist/interfaces/worker/main.js', 'console.log(${JSON.stringify(marker)}); setInterval(() => {}, 60000);');`,
      '',
    ].join('\n'),
  );
}

function gitIn(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'e2e',
      GIT_AUTHOR_EMAIL: 'e2e@example.org',
      GIT_COMMITTER_NAME: 'e2e',
      GIT_COMMITTER_EMAIL: 'e2e@example.org',
    },
  });
}

describe.skipIf(!onDebianAsRoot)('E2E: maintenance keeps the installed box alive', () => {
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'kobox-maint-e2e-'));
    backupRoot = join(workDir, 'backups');
    execFileSync('bash', ['docker/e2e-setup.sh']);
    pebbleAvailable = await probePebble();

    env = {
      ...process.env,
      KOBOX_DB: join(workDir, 'kobox.db'),
      KOBOX_SPOOL: join(workDir, 'events'),
      KOBOX_BIN: `/usr/bin/env node ${process.cwd()}/${CLI}`,
      KOBOX_STRICT_SERVICES: '1',
      KOBOX_VPN_REMOTE: 'seedbox.example.org',
      KOBOX_BACKUP_ROOT: backupRoot,
      ...(pebbleAvailable && {
        KOBOX_LE_DOMAIN: LE_DOMAIN,
        KOBOX_LE_EMAIL: 'ops@example.org',
        KOBOX_ACME_URL: PEBBLE_URL,
        KOBOX_ACME_CA_BUNDLE: PEBBLE_CA,
      }),
    };
    if (!pebbleAvailable) {
      console.warn('pebble fixture unreachable — letsencrypt stays skipped in this run');
    }

    // the box: the earlier install suite uninstalled at its end — converge
    // the whole stack again (idempotent, packages cached)
    await execFileAsync('node', [CLI, 'install', '--allow-non-ext4'], {
      env,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    originalCurrentTarget = readlinkSync(CURRENT_LINK);
    await waitFor('worker active', () => isActive('kobox-worker'), 60_000);
  }, INSTALL_TIMEOUT_MS);

  afterAll(() => {
    // the container is shared with the later E2E suites (Phase 3/4 rule):
    // every unit/timer this suite armed goes down, the flipped symlink
    // returns to the real tree, fail2ban stays off
    if (originalCurrentTarget !== undefined) {
      try {
        execFileSync('ln', ['-sfn', originalCurrentTarget, CURRENT_LINK]);
      } catch { /* keep going */ }
    }
    try {
      kobox(['uninstall', '--yes']);
    } catch { /* report below via unit disables */ }
    for (const unit of ['kobox-worker', 'kobox-firewall', 'fail2ban', 'certbot.timer']) {
      try {
        execFileSync('systemctl', ['disable', '--now', unit], { stdio: 'ignore' });
      } catch { /* absent */ }
    }
    rmSync('/etc/cron.d/kobox', { force: true });
    for (const args of [
      ['-P', 'INPUT', 'ACCEPT'], ['-P', 'FORWARD', 'ACCEPT'], ['-F'], ['-X'],
    ]) {
      try {
        execFileSync('iptables', args, { stdio: 'ignore' });
      } catch { /* table may be empty */ }
    }
  }, 120_000);

  it('should_have_installed_the_declarative_scheduler', () => {
    const cron = readFileSync('/etc/cron.d/kobox', 'utf8');
    expect(cron).toContain('resolve-dyndns');
    expect(cron).toContain('send-mails');
    expect(cron).toContain('evaluate-fair-use');
    expect(cron).toContain('update-blocklists');
    expect(cron).toContain('renew-tracker-certs');
    expect(cron).toContain('run-backup');
    expect(isActive('cron')).toBe(true);
  });

  it(
    'should_execute_every_cron_entry_for_real_and_dedupe_repeated_ticks',
    async () => {
      // freeze the queue so pending rows are observable
      sh('systemctl', ['stop', 'kobox-worker']);
      const entries = readFileSync('/etc/cron.d/kobox', 'utf8')
        .split('\n')
        .filter((line) => line !== '' && !line.startsWith('#') && !/^[A-Z]+=/.test(line))
        .map((line) => line.split(' ').slice(6)); // five schedule fields + 'root'
      expect(entries).toHaveLength(7);

      // a real tick: run the exact command cron would run — twice
      for (const round of [1, 2]) {
        for (const argv of entries) {
          const [command, ...args] = argv;
          if (command === undefined) throw new Error('empty cron entry');
          await execFileAsync(command, args, { env, timeout: 60_000 });
        }
        expect(round).toBeGreaterThan(0);
      }

      // enqueueUnique: the second tick added nothing
      const counts = jobCounts();
      for (const type of [
        'resolve-dyndns', 'send-mails', 'evaluate-fair-use',
        'update-blocklists', 'renew-tracker-certs', 'run-backup',
        'poll-debrid-downloads',
      ]) {
        expect(counts.get(type)?.pending, type).toBe(1);
      }

      // the systemd worker drains the tick for real
      sh('systemctl', ['start', 'kobox-worker']);
      await waitFor('tick drained', () => {
        const after = jobCounts();
        return [...after.values()].every((entry) => entry.pending === 0);
      }, 180_000);
      for (const [type, entry] of jobCounts()) {
        expect(entry.failed, `${type} failed`).toBe(0);
      }
    },
    300_000,
  );

  it(
    'should_flush_the_outbox_through_the_local_postfix',
    async () => {
      const db = openDb();
      db.raw
        .prepare(
          "INSERT INTO mails (recipient, subject, body, next_attempt_at, created_at) VALUES ('root@localhost', 'KoBox e2e outbox proof', 'delivered through the relay', datetime('now'), datetime('now'))",
        )
        .run();
      db.close();
      rmSync('/var/mail/root', { force: true });

      kobox(['send-mails']);
      await waitFor('mail sent', () => {
        const db2 = openDb();
        const row = db2.raw
          .prepare("SELECT status FROM mails WHERE subject = 'KoBox e2e outbox proof'")
          .get() as { status: string } | undefined;
        db2.close();
        return row?.status === 'sent';
      }, 60_000);

      // postfix local delivery is async — the mbox lands within seconds
      await waitFor(
        'postfix delivery',
        () =>
          existsSync('/var/mail/root') &&
          readFileSync('/var/mail/root', 'utf8').includes('KoBox e2e outbox proof'),
        60_000,
      );
    },
    120_000,
  );

  it(
    'should_backup_then_restore_the_database',
    async () => {
      kobox(['run-backup']);
      await waitFor('backup created', () => {
        return existsSync(backupRoot) && sh('ls', [backupRoot]).trim() !== '';
      }, 60_000);
      const stamp = sh('ls', [backupRoot]).trim().split('\n').at(-1) ?? '';
      const backupDir = join(backupRoot, stamp);
      expect(existsSync(join(backupDir, 'kobox.db'))).toBe(true);
      expect(existsSync(join(backupDir, 'etc-kobox.tar.gz'))).toBe(true);

      // canary written AFTER the backup must vanish on restore
      const db = openDb();
      db.raw
        .prepare(
          "INSERT INTO mails (recipient, subject, body, next_attempt_at, created_at) VALUES ('root@localhost', 'post-backup canary', 'x', datetime('now'), datetime('now'))",
        )
        .run();
      db.close();

      const output = kobox(['restore-backup', backupDir, '--yes']);
      expect(output).toContain('restored');

      const restored = openDb();
      const canary = restored.raw
        .prepare("SELECT COUNT(*) AS n FROM mails WHERE subject = 'post-backup canary'")
        .get() as { n: number };
      restored.close();
      expect(canary.n).toBe(0);
      await waitFor('worker back after restore', () => isActive('kobox-worker'), 60_000);
    },
    180_000,
  );

  it('should_serve_acme_challenges_from_the_webroot_even_with_a_real_host_header', () => {
    // pebble's VA is stubbed (PEBBLE_VA_ALWAYS_VALID) — prove the HTTP-01
    // wiring ourselves: the Debian default site must be gone and the :80
    // block must serve the webroot for the real domain's Host
    expect(existsSync('/etc/nginx/sites-enabled/default')).toBe(false);
    mkdirSync('/var/www/acme/.well-known/acme-challenge', { recursive: true });
    writeFileSync('/var/www/acme/.well-known/acme-challenge/kobox-probe', 'acme-probe-ok\n');

    const body = sh('curl', [
      '-s', '-H', `Host: ${LE_DOMAIN}`,
      'http://127.0.0.1/.well-known/acme-challenge/kobox-probe',
    ]);

    expect(body).toContain('acme-probe-ok');
    rmSync('/var/www/acme/.well-known', { recursive: true, force: true });
  });

  it.skipIf(!onDebianAsRoot)(
    'should_serve_the_pebble_issued_certificate_when_the_fixture_is_up',
    () => {
      if (!pebbleAvailable) {
        console.warn('pebble unreachable — letsencrypt path validated only by component tests');
        const status = JSON.parse(kobox(['install-status'])) as { name: string; state: string }[];
        expect(status.find((row) => row.name === 'letsencrypt')?.state).toBe('skipped');
        return;
      }
      expect(existsSync(`/etc/letsencrypt/live/${LE_DOMAIN}/fullchain.pem`)).toBe(true);
      const vhost = readFileSync('/etc/nginx/conf.d/kobox.conf', 'utf8');
      expect(vhost).toContain(`ssl_certificate /etc/letsencrypt/live/${LE_DOMAIN}/fullchain.pem;`);
      expect(existsSync('/etc/letsencrypt/renewal-hooks/deploy/kobox-nginx')).toBe(true);
      expect(sh('systemctl', ['is-enabled', 'certbot.timer'], { stdio: 'pipe' }).trim()).toBe(
        'enabled',
      );
      // nginx actually serves the pebble-issued chain on the portal port
      const served = sh('openssl', ['s_client', '-connect', '127.0.0.1:8189', '-servername', LE_DOMAIN], {
        input: '',
        stdio: 'pipe',
      });
      expect(served).toContain('Pebble Intermediate CA');
    },
    60_000,
  );

  it(
    'should_upgrade_rollback_and_survive_a_sabotaged_release',
    async () => {
      // scratch repo (file:// only): the mounted checkout is NEVER touched
      const repo = join(workDir, 'release-repo');
      mkdirSync(repo);
      gitIn(repo, ['init', '-q', '-b', 'main']);
      scaffoldFakeRelease(repo, 'fake-release-v1', false);
      execFileSync('corepack', ['pnpm', 'install', '--dir', join(repo, 'kobox')], {
        stdio: 'ignore',
      });
      gitIn(repo, ['add', '.']);
      gitIn(repo, ['commit', '-qm', 'v1']);
      gitIn(repo, ['tag', 'v1.0.0']);
      scaffoldFakeRelease(repo, 'fake-release-v2', false);
      gitIn(repo, ['commit', '-aqm', 'v2']);
      gitIn(repo, ['tag', 'v2.0.0']);
      scaffoldFakeRelease(repo, 'fake-release-v3', true); // broken build
      gitIn(repo, ['commit', '-aqm', 'v3']);
      gitIn(repo, ['tag', 'v3.0.0']);
      scaffoldFakeRelease(repo, 'fake-release-v2', false); // repo tip = good
      gitIn(repo, ['commit', '-aqm', 'tip']);

      const releasesDir = join(workDir, 'releases');
      const upgradeEnv = {
        ...env,
        KOBOX_REPO_DIR: repo,
        KOBOX_RELEASES_DIR: releasesDir,
      };

      // upgrade to v1: link flips, the (stub) worker comes up
      await execFileAsync('node', [CLI, 'upgrade', '--to', 'v1.0.0', '--offline'], {
        env: upgradeEnv,
        timeout: 300_000,
      });
      expect(readlinkSync(CURRENT_LINK)).toContain(releasesDir);
      expect(isActive('kobox-worker')).toBe(true);

      // upgrade to v2 then roll back to v1
      await execFileAsync('node', [CLI, 'upgrade', '--to', 'v2.0.0', '--offline'], {
        env: upgradeEnv,
        timeout: 300_000,
      });
      const v2Target = readlinkSync(CURRENT_LINK);
      await execFileAsync('node', [CLI, 'upgrade', '--rollback'], {
        env: upgradeEnv,
        timeout: 120_000,
      });
      expect(readlinkSync(CURRENT_LINK)).not.toBe(v2Target);
      expect(isActive('kobox-worker')).toBe(true);

      // sabotaged build: the running release survives untouched
      const before = readlinkSync(CURRENT_LINK);
      await expect(
        execFileAsync('node', [CLI, 'upgrade', '--to', 'v3.0.0', '--offline'], {
          env: upgradeEnv,
          timeout: 300_000,
        }),
      ).rejects.toThrow();
      expect(readlinkSync(CURRENT_LINK)).toBe(before);
      expect(isActive('kobox-worker')).toBe(true);

      // the ledger tells the truth
      const db = openDb();
      const rows = db.raw
        .prepare('SELECT ref, state FROM releases ORDER BY id')
        .all() as { ref: string; state: string }[];
      db.close();
      expect(rows.map((row) => [row.ref, row.state])).toEqual([
        ['v1.0.0', 'current'],
        ['v2.0.0', 'previous'],
        ['v3.0.0', 'failed'],
      ]);

      // hand the real tree back to the worker for the remaining suites
      // (reset-failed first: this test just restarted the unit repeatedly)
      if (originalCurrentTarget !== undefined) {
        execFileSync('ln', ['-sfn', originalCurrentTarget, CURRENT_LINK]);
        sh('systemctl', ['reset-failed', 'kobox-worker']);
        sh('systemctl', ['restart', 'kobox-worker']);
        await waitFor('real worker back', () => isActive('kobox-worker'), 60_000);
      }
    },
    900_000,
  );
});
