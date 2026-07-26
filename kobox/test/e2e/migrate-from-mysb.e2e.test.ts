import { execFileSync, spawn, type ChildProcess, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDump } from '../fixtures/migration/buildDump.js';

// Migration & Cutover E2E on a fresh Debian 12: a frozen MySB dump ->
// `kobox migrate-from-mysb --apply` -> real root worker provisions the user ->
// the imported user gets their temporary password by mail, is forced to reset
// it, then reaches ruTorrent and downloads their .ovpn. Requires root+systemd
// (make e2e).

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const CLI = 'dist/interfaces/cli/main.js';
const WORKER = 'dist/interfaces/worker/main.js';
const PORTAL = 'dist/interfaces/http/main.js';
const MEMBER = 'e2eimported';
const PORT = 8198;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const NEW_PASSWORD = 's3cretpw!';

let env: NodeJS.ProcessEnv;
let dbPath: string;
let dumpDir: string;
let portal: ChildProcess | undefined;

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[]): string {
  return sh('node', [CLI, ...args]);
}

function drainQueue(): void {
  sh('node', [WORKER, '--once']);
}

function userExists(name: string): boolean {
  try {
    sh('id', ['-u', name], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function cleanupUser(name: string): void {
  if (userExists(name)) {
    try {
      execFileSync('systemctl', ['disable', '--now', `rtorrent-${name}`], { stdio: 'ignore' });
    } catch {
      /* unit may not exist */
    }
    execFileSync('userdel', ['-r', name], { stdio: 'ignore' });
  }
}

function sessionCookie(setCookie: string[] | null): string | undefined {
  return setCookie?.find((line) => line.startsWith('kobox_session='))?.split(';')[0];
}

async function csrfFrom(path: string, cookie: string): Promise<string> {
  const response = await fetch(`${BASE}${path}`, { headers: { cookie } });
  return /name="_csrf" value="([^"]+)"/.exec(await response.text())?.[1] ?? '';
}

async function login(username: string, password: string): Promise<string | undefined> {
  const response = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=${username}&password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  });
  return sessionCookie(response.headers.getSetCookie());
}

// The temporary password only exists in the durable outbox (never the jobs DB),
// exactly as the real user receives it by mail.
function temporaryPasswordFromMail(): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT body FROM mails WHERE recipient = ? LIMIT 1').get(`${MEMBER}@example.org`) as
      | { body: string }
      | undefined;
    return /temporary password: (\S+)/.exec(row?.body ?? '')?.[1] ?? '';
  } finally {
    db.close();
  }
}

async function waitForPortal(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) {
        return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('portal did not come up');
}

describe.skipIf(!onDebianAsRoot)('E2E: migrate-from-mysb -> forced reset -> full access', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-migrate-e2e-'));
    const pkiDir = join(dir, 'pki');
    dbPath = join(dir, 'kobox.db');
    env = {
      ...process.env,
      KOBOX_DB: dbPath,
      KOBOX_SPOOL: join(dir, 'events'),
      KOBOX_PORTAL_HTTP_PORT: String(PORT),
      KOBOX_VPN_REMOTE: 'vpn.example.org',
      KOBOX_VPN_PKI: pkiDir,
    };
    sh('bash', ['docker/e2e-setup.sh']);
    try {
      execFileSync('groupadd', ['--system', 'kobox-portal'], { stdio: 'ignore' });
    } catch {
      /* already exists */
    }
    cleanupUser(MEMBER);

    // Fixture PKI (easy-rsa absent here): stage the imported user's client
    // material so `render-openvpn` can produce their .ovpn.
    mkdirSync(join(pkiDir, 'issued'), { recursive: true });
    mkdirSync(join(pkiDir, 'private'), { recursive: true });
    writeFileSync(join(pkiDir, 'ca.crt'), '-----BEGIN CERTIFICATE-----\nE2E-CA\n-----END CERTIFICATE-----\n');
    writeFileSync(join(pkiDir, `issued/${MEMBER}.crt`), `-----BEGIN CERTIFICATE-----\n${MEMBER}-CRT\n-----END CERTIFICATE-----\n`);
    writeFileSync(join(pkiDir, `private/${MEMBER}.key`), `-----BEGIN PRIVATE KEY-----\n${MEMBER}-KEY\n-----END PRIVATE KEY-----\n`);

    // a neutral one-user dump with a tracker
    dumpDir = buildDump({
      users: [
        {
          username: MEMBER,
          email: `${MEMBER}@example.org`,
          scgiPort: 51150,
          rtorrentPort: 45050,
          syncMode: [0, 0],
        },
      ],
      trackers: [{ host: 'tracker.example.org', proto: 'https', port: 443, privacy: 'private' }],
    });

    kobox(['migrate-from-mysb', '--dump', dumpDir, '--apply']);
    let guard = 0;
    while (guard < 25) {
      drainQueue();
      guard += 1;
      if (existsSync(`/home/${MEMBER}/.rtorrent.rc`)) {
        break;
      }
    }
    kobox(['render-openvpn']);
    drainQueue();

    portal = spawn('node', [PORTAL], { env, stdio: 'ignore' });
    await waitForPortal();
  });

  afterAll(() => {
    portal?.kill('SIGTERM');
    cleanupUser(MEMBER);
  });

  it('should_provision_the_imported_user_with_a_system_account_and_rtorrent', () => {
    expect(userExists(MEMBER)).toBe(true);
    expect(existsSync(`/home/${MEMBER}/.rtorrent.rc`)).toBe(true);
    const include = sh('cat', ['/etc/nginx/kobox.d/rutorrent-users.conf']);
    expect(include).toContain(`/RPC-${MEMBER.toUpperCase()}`);
  });

  it('should_force_the_imported_user_to_reset_before_granting_access', async () => {
    const tempPassword = temporaryPasswordFromMail();
    expect(tempPassword.length).toBeGreaterThan(8);

    const cookie = (await login(MEMBER, tempPassword)) ?? '';
    expect(cookie).not.toBe('');

    // every page funnels to /password
    const home = await fetch(`${BASE}/`, { headers: { cookie }, redirect: 'manual' });
    expect(home.status).toBe(303);
    expect(home.headers.get('location')).toBe('/password');

    // ruTorrent stays closed until the reset is done
    const rpc = await fetch(`${BASE}/internal/auth/rpc`, {
      headers: { cookie, 'x-original-uri': `/RPC-${MEMBER.toUpperCase()}` },
    });
    expect(rpc.status).toBe(403);
  });

  it('should_grant_rutorrent_and_the_ovpn_profile_after_the_reset', async () => {
    const tempPassword = temporaryPasswordFromMail();
    const cookie = (await login(MEMBER, tempPassword)) ?? '';
    const csrf = await csrfFrom('/password', cookie);

    const changed = await fetch(`${BASE}/password`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `_csrf=${encodeURIComponent(csrf)}&current=${encodeURIComponent(tempPassword)}&next=${encodeURIComponent(NEW_PASSWORD)}`,
      redirect: 'manual',
    });
    expect(changed.status).toBe(303);
    drainQueue(); // the change-password job clears must_change and rotates the hash

    const fresh = (await login(MEMBER, NEW_PASSWORD)) ?? '';
    const home = await fetch(`${BASE}/`, { headers: { cookie: fresh }, redirect: 'manual' });
    expect(home.status).toBe(200);

    const profile = await fetch(`${BASE}/access/ovpn/tun`, { headers: { cookie: fresh } });
    expect(profile.status).toBe(200);
    expect(await profile.text()).toContain('remote vpn.example.org');

    const ru = await fetch(`${BASE}/rutorrent`, { headers: { cookie: fresh } });
    expect(await ru.text()).toContain('/ru/');
  });
});
