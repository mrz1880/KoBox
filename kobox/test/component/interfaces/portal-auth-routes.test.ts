import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Authenticate } from '../../../src/application/portal/Authenticate.js';
import { Login } from '../../../src/application/portal/Login.js';
import { Logout } from '../../../src/application/portal/Logout.js';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../src/domain/user/Password.js';
import { Username } from '../../../src/domain/user/Username.js';
import type { PasswordHasherPort } from '../../../src/domain/user/ports.js';
import { InMemoryLoginAttemptsRepository } from '../../../src/infrastructure/persistence/InMemoryLoginAttemptsRepository.js';
import { InMemoryPortalCredentialsRepository } from '../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryPortalSessionRepository } from '../../../src/infrastructure/persistence/InMemoryPortalSessionRepository.js';
import { InMemoryUserRepository } from '../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeSessionTokens } from '../../../src/infrastructure/system/fakes/FakeSessionTokens.js';
import { buildPortalServer } from '../../../src/interfaces/http/server.js';
import { UserBuilder } from '../../builders/UserBuilder.js';
import { InMemoryBlocklistRepository } from '../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { InMemoryTrackerRepository } from '../../../src/infrastructure/persistence/InMemoryTrackerRepository.js';
import { RecordingQueue } from './portalWorld.js';

const NOW = '2026-07-25 10:00:00';
const GOOD_HASH = HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}8`);

class FakeHasher implements PasswordHasherPort {
  hash(password: Password): Promise<HashedPassword> {
    return Promise.resolve(
      HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}${String(password.reveal().length)}`),
    );
  }

  async verify(password: Password, hash: HashedPassword): Promise<boolean> {
    return (await this.hash(password)).value === hash.value;
  }
}

interface World {
  server: FastifyInstance;
  users: InMemoryUserRepository;
  credentials: InMemoryPortalCredentialsRepository;
  sessions: InMemoryPortalSessionRepository;
}

let world: World;

beforeEach(async () => {
  const users = new InMemoryUserRepository();
  const credentials = new InMemoryPortalCredentialsRepository();
  const sessions = new InMemoryPortalSessionRepository();
  const attempts = new InMemoryLoginAttemptsRepository();
  const tokens = new FakeSessionTokens();
  const hasher = new FakeHasher();
  const authDeps = { users, credentials, sessions, attempts, tokens, hasher };
  const server = buildPortalServer({
    login: new Login(authDeps),
    logout: new Logout(authDeps),
    authenticate: new Authenticate(authDeps),
    now: () => NOW,
    users,
    queue: new RecordingQueue(),
    hasher,
    trackers: new InMemoryTrackerRepository(),
    blocklists: new InMemoryBlocklistRepository(),
  });
  world = { server, users, credentials, sessions };
  await users.save(new UserBuilder().build());
  await credentials.save(
    { username: Username.parse('alice'), passwordHash: GOOD_HASH, role: 'user' },
    NOW,
  );
  await users.save(new UserBuilder().withUsername('boss').withScgiPort(51102).withRtorrentPort(45001).build());
  await credentials.save(
    { username: Username.parse('boss'), passwordHash: GOOD_HASH, role: 'admin' },
    NOW,
  );
});

async function loginAs(username: string): Promise<{ cookie: string; csrf: string }> {
  const response = await world.server.inject({
    method: 'POST',
    url: '/login',
    payload: `username=${username}&password=8chars!!`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = (raw ?? '').split(';')[0] ?? '';
  const home = await world.server.inject({ method: 'GET', url: '/', headers: { cookie } });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(home.body)?.[1] ?? '';
  return { cookie, csrf };
}

describe('login page and flow', () => {
  it('should_serve_the_login_form', async () => {
    const response = await world.server.inject({ method: 'GET', url: '/login' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('name="username"');
    expect(response.body).toContain('type="password"');
  });

  it('should_set_a_hardened_session_cookie_and_redirect_on_success', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/login',
      payload: 'username=alice&password=8chars!!',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/');
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('kobox_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
  });

  it('should_re_render_the_form_without_cookie_on_bad_credentials', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/login',
      payload: 'username=alice&password=wrong-password',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Invalid credentials');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('should_never_500_on_malformed_usernames', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/login',
      payload: 'username=Tony%20Z%3B%20rm%20-rf%20%2F&password=x',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Invalid credentials');
  });
});

describe('session guard', () => {
  it('should_redirect_anonymous_visitors_to_login', async () => {
    const response = await world.server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/login');
  });

  it('should_serve_the_home_page_to_a_logged_in_user', async () => {
    const { cookie } = await loginAs('alice');

    const response = await world.server.inject({ method: 'GET', url: '/', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('alice');
  });
});

describe('logout', () => {
  it('should_require_a_csrf_token', async () => {
    const { cookie } = await loginAs('alice');

    const response = await world.server.inject({
      method: 'POST',
      url: '/logout',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });

    expect(response.statusCode).toBe(403);
  });

  it('should_clear_the_session_and_cookie', async () => {
    const { cookie, csrf } = await loginAs('alice');

    const response = await world.server.inject({
      method: 'POST',
      url: '/logout',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${csrf}`,
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/login');
    const after = await world.server.inject({ method: 'GET', url: '/', headers: { cookie } });
    expect(after.statusCode).toBe(303);
  });
});

describe('nginx auth_request endpoints', () => {
  it('should_return_401_without_a_session_and_204_with_one', async () => {
    const anonymous = await world.server.inject({ method: 'GET', url: '/internal/auth' });
    expect(anonymous.statusCode).toBe(401);

    const { cookie } = await loginAs('alice');
    const authed = await world.server.inject({
      method: 'GET',
      url: '/internal/auth',
      headers: { cookie },
    });
    expect(authed.statusCode).toBe(204);
    expect(authed.headers['x-kobox-user']).toBe('alice');
  });

  it('should_scope_rpc_mounts_to_their_user_or_an_admin', async () => {
    const { cookie: aliceCookie } = await loginAs('alice');
    const { cookie: bossCookie } = await loginAs('boss');

    const own = await world.server.inject({
      method: 'GET',
      url: '/internal/auth/rpc',
      headers: { cookie: aliceCookie, 'x-original-uri': '/RPC-ALICE' },
    });
    const foreign = await world.server.inject({
      method: 'GET',
      url: '/internal/auth/rpc',
      headers: { cookie: aliceCookie, 'x-original-uri': '/RPC-BOSS' },
    });
    const admin = await world.server.inject({
      method: 'GET',
      url: '/internal/auth/rpc',
      headers: { cookie: bossCookie, 'x-original-uri': '/RPC-ALICE' },
    });

    expect(own.statusCode).toBe(204);
    expect(foreign.statusCode).toBe(403);
    expect(admin.statusCode).toBe(204);
  });

  it('should_gate_the_admin_probe_on_role', async () => {
    const { cookie: aliceCookie } = await loginAs('alice');
    const { cookie: bossCookie } = await loginAs('boss');

    const denied = await world.server.inject({
      method: 'GET',
      url: '/internal/auth/admin',
      headers: { cookie: aliceCookie },
    });
    const allowed = await world.server.inject({
      method: 'GET',
      url: '/internal/auth/admin',
      headers: { cookie: bossCookie },
    });

    expect(denied.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(204);
  });
});
