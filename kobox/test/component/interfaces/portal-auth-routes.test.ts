import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPortalWorld,
  loginAs as loginTo,
  NOW,
  TEST_PASSWORD,
  type PortalWorld,
} from './portalWorld.js';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import { Username } from '../../../src/domain/user/Username.js';
import { FakeSessionTokens } from '../../../src/infrastructure/system/fakes/FakeSessionTokens.js';

let world: PortalWorld;

beforeEach(async () => {
  world = await buildPortalWorld();
});

async function loginAs(username: string): Promise<{ cookie: string; csrf: string }> {
  return loginTo(world, username);
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

describe('a machine presenting HTTP Basic', () => {
  const TOKEN = 'a'.repeat(64);

  async function withToken(): Promise<PortalWorld> {
    const world = await buildPortalWorld();
    const tokens = new FakeSessionTokens();
    await world.credentials.save(
      {
        username: Username.parse('alice'),
        passwordHash: HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}8`),
        role: 'user',
        appTokenHash: tokens.hashToken(TOKEN),
      },
      NOW,
    );
    return world;
  }

  function basic(user: string, secret: string): string {
    return `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
  }

  it('should_let_a_download_client_through_with_its_token', async () => {
    // Radarr and Sonarr drive rTorrent through ruTorrent's httprpc endpoint and
    // have no cookie: without this, automation stops dead at cutover.
    const world = await withToken();

    const response = await world.server.inject({
      method: 'GET',
      url: '/internal/auth',
      headers: { authorization: basic('alice', TOKEN) },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['x-kobox-user']).toBe('alice');
  });

  it('should_refuse_the_account_password_on_that_door', async () => {
    // the token is the machine credential; accepting the password here would
    // put the portal account itself in every download client's config file
    const world = await withToken();

    const response = await world.server.inject({
      method: 'GET',
      url: '/internal/auth',
      headers: { authorization: basic('alice', TEST_PASSWORD) },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should_scope_the_rpc_mount_to_its_owner', async () => {
    const world = await withToken();

    const own = await world.server.inject({
      method: 'GET',
      url: '/internal/auth/rpc',
      headers: { authorization: basic('alice', TOKEN), 'x-original-uri': '/RPC-ALICE' },
    });
    const other = await world.server.inject({
      method: 'GET',
      url: '/internal/auth/rpc',
      headers: { authorization: basic('alice', TOKEN), 'x-original-uri': '/RPC-BOSS' },
    });

    expect(own.statusCode).toBe(204);
    expect(other.statusCode).toBe(403);
  });

  it('should_refuse_a_token_that_was_never_issued', async () => {
    const world = await buildPortalWorld();

    const response = await world.server.inject({
      method: 'GET',
      url: '/internal/auth',
      headers: { authorization: basic('alice', TOKEN) },
    });

    expect(response.statusCode).toBe(401);
  });
});
