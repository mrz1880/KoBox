import { execFileSync, spawn, type ChildProcess, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Portal & Access E2E on a fresh Debian 12: real CLI enqueue -> real root
// worker -> real accounts, and the real SSR portal (non-root HTTP) driven over
// HTTP with a cookie jar. Requires: pnpm build, root, systemd (make e2e).

const onDebianAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
const CLI = 'dist/interfaces/cli/main.js';
const WORKER = 'dist/interfaces/worker/main.js';
const PORTAL = 'dist/interfaces/http/main.js';
const ADMIN = 'bossadmin';
const MEMBER = 'e2eportaluser';
const PORT = 8199;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const PASSWORD = 's3cretpw!';

let env: NodeJS.ProcessEnv;
let portal: ChildProcess | undefined;

function sh(command: string, args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', env, ...options }) as string;
}

function kobox(args: string[], stdin?: string): string {
  return sh('node', [CLI, ...args], stdin === undefined ? {} : { input: stdin });
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

// minimal cookie jar: keep the kobox_session pair regardless of the Secure
// attribute (the client speaks plain HTTP to 127.0.0.1 in the test).
function sessionCookie(setCookie: string[] | null): string | undefined {
  const header = setCookie?.find((line) => line.startsWith('kobox_session='));
  return header?.split(';')[0];
}

async function csrfFrom(path: string, cookie: string): Promise<string> {
  const response = await fetch(`${BASE}${path}`, { headers: { cookie } });
  const body = await response.text();
  return /name="_csrf" value="([^"]+)"/.exec(body)?.[1] ?? '';
}

async function login(username: string): Promise<string | undefined> {
  const response = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `username=${username}&password=${encodeURIComponent(PASSWORD)}`,
    redirect: 'manual',
  });
  return sessionCookie(response.headers.getSetCookie());
}

async function waitForPortal(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('portal did not come up');
}

describe.skipIf(!onDebianAsRoot)('E2E: portal login -> create user -> member self-service', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kobox-portal-e2e-'));
    const pkiDir = join(dir, 'pki');
    env = {
      ...process.env,
      KOBOX_DB: join(dir, 'kobox.db'),
      KOBOX_SPOOL: join(dir, 'events'),
      KOBOX_PORTAL_HTTP_PORT: String(PORT),
      KOBOX_VPN_REMOTE: 'vpn.example.org',
      KOBOX_VPN_PKI: pkiDir,
    };
    sh('bash', ['docker/e2e-setup.sh']);
    // precondition the real kobox-core installer provides: the non-root portal
    // group that owns the rendered .ovpn profiles (this suite skips full
    // `kobox install`). Idempotent: exit 9 = already exists.
    try {
      execFileSync('groupadd', ['--system', 'kobox-portal'], { stdio: 'ignore' });
    } catch {
      /* already exists */
    }
    cleanupUser(ADMIN);
    cleanupUser(MEMBER);

    // Fixture PKI tree (easy-rsa shape): this E2E exercises the PORTAL, not VPN
    // cert issuance (that is security-network's job) — real easy-rsa is absent
    // here, so the client material is staged directly and render-openvpn reads
    // it. Both ADMIN and MEMBER get material so render-openvpn renders both.
    mkdirSync(join(pkiDir, 'issued'), { recursive: true });
    mkdirSync(join(pkiDir, 'private'), { recursive: true });
    writeFileSync(join(pkiDir, 'ca.crt'), '-----BEGIN CERTIFICATE-----\nE2E-CA\n-----END CERTIFICATE-----\n');
    for (const name of [ADMIN, MEMBER]) {
      writeFileSync(join(pkiDir, `issued/${name}.crt`), `-----BEGIN CERTIFICATE-----\n${name}-CRT\n-----END CERTIFICATE-----\n`);
      writeFileSync(join(pkiDir, `private/${name}.key`), `-----BEGIN PRIVATE KEY-----\n${name}-KEY\n-----END PRIVATE KEY-----\n`);
    }

    // seed an admin through the real privilege seam
    kobox(['create-user', ADMIN, '--email', `${ADMIN}@example.org`, '--admin', '--quota-gib', '10'], `${PASSWORD}\n`);
    let guard = 0;
    while (guard < 20) {
      drainQueue();
      guard += 1;
      if (existsSync(`/home/${ADMIN}/.rtorrent.rc`)) {
        break;
      }
    }

    portal = spawn('node', [PORTAL], { env, stdio: 'ignore' });
    await waitForPortal();
  });

  afterAll(() => {
    portal?.kill('SIGTERM');
    cleanupUser(ADMIN);
    cleanupUser(MEMBER);
  });

  it('should_reject_a_wrong_password_and_accept_the_admin', async () => {
    const bad = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `username=${ADMIN}&password=wrong-password`,
      redirect: 'manual',
    });
    expect(sessionCookie(bad.headers.getSetCookie())).toBeUndefined();

    const cookie = await login(ADMIN);
    expect(cookie).toBeDefined();
  });

  it('should_create_a_member_through_the_portal_and_let_them_sign_in', async () => {
    const cookie = (await login(ADMIN)) ?? '';
    const csrf = await csrfFrom('/admin/users', cookie);

    const created = await fetch(`${BASE}/admin/users`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body:
        `_csrf=${encodeURIComponent(csrf)}&username=${MEMBER}` +
        `&email=${MEMBER}%40example.org&password=${encodeURIComponent(PASSWORD)}` +
        '&quotaGib=10&accountType=normal&role=user',
      redirect: 'manual',
    });
    expect(created.status).toBe(303);
    expect(userExists(MEMBER)).toBe(false); // unprivileged path only enqueued

    let guard = 0;
    while (guard < 20) {
      drainQueue();
      guard += 1;
      if (existsSync(`/home/${MEMBER}/.rtorrent.rc`)) {
        break;
      }
    }
    expect(userExists(MEMBER)).toBe(true);

    // the member can now sign in to the portal (credentials row was written)
    const memberCookie = await login(MEMBER);
    expect(memberCookie).toBeDefined();
  });

  it('should_serve_the_member_their_ovpn_profile_and_frame_rutorrent', async () => {
    // render the profiles from the staged fixture material (the chained
    // provision-vpn-user cannot issue without easy-rsa in this container)
    kobox(['render-openvpn']);
    drainQueue();

    const cookie = (await login(MEMBER)) ?? '';

    const profile = await fetch(`${BASE}/access/ovpn/tun`, { headers: { cookie } });
    expect(profile.status).toBe(200);
    expect(await profile.text()).toContain('remote vpn.example.org');

    const ru = await fetch(`${BASE}/rutorrent`, { headers: { cookie } });
    expect(await ru.text()).toContain('/ru/');
  });

  it('should_scope_the_rpc_auth_endpoint_to_the_session_owner', async () => {
    const cookie = (await login(MEMBER)) ?? '';

    const own = await fetch(`${BASE}/internal/auth/rpc`, {
      headers: { cookie, 'x-original-uri': `/RPC-${MEMBER.toUpperCase()}` },
    });
    const foreign = await fetch(`${BASE}/internal/auth/rpc`, {
      headers: { cookie, 'x-original-uri': `/RPC-${ADMIN.toUpperCase()}` },
    });

    expect(own.status).toBe(204);
    expect(foreign.status).toBe(403);
  });

  it('should_render_the_per_user_nginx_rpc_include', () => {
    expect(existsSync('/etc/nginx/kobox.d/rutorrent-users.conf')).toBe(true);
    const include = sh('cat', ['/etc/nginx/kobox.d/rutorrent-users.conf']);
    expect(include).toContain(`/RPC-${MEMBER.toUpperCase()}`);
  });

  it('should_refuse_a_suspended_member', async () => {
    kobox(['suspend-user', MEMBER]);
    drainQueue();

    const response = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `username=${MEMBER}&password=${encodeURIComponent(PASSWORD)}`,
      redirect: 'manual',
    });

    expect(sessionCookie(response.headers.getSetCookie())).toBeUndefined();
    const body = await response.text();
    expect(body).toContain('suspended');
  });
});
