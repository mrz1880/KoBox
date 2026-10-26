import { beforeEach, describe, expect, it } from 'vitest';
import { withoutCredential } from '../../../src/domain/portal/credentials.js';
import { Username } from '../../../src/domain/user/Username.js';
import { buildPortalWorld, form, loginAs, TEST_PASSWORD, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;

beforeEach(async () => {
  world = await buildPortalWorld();
});

async function passwordOnly(username: string): Promise<{ cookie: string; location: string }> {
  const response = await world.server.inject({
    method: 'POST',
    url: '/login',
    payload: `username=${username}&password=${TEST_PASSWORD}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return { cookie: (raw ?? '').split(';')[0] ?? '', location: String(response.headers.location) };
}

describe('signing in with a two-step code', () => {
  it('should_ask_for_the_code_and_open_nothing_before_it', async () => {
    const { cookie, location } = await passwordOnly('boss');

    expect(location).toBe('/login/code');
    const home = await world.server.inject({ method: 'GET', url: '/', headers: { cookie } });
    expect(home.headers.location).toBe('/login/code');
    // nginx asks the same question for ruTorrent and Nextcloud
    const nginx = await world.server.inject({ method: 'GET', url: '/internal/auth/session', headers: { cookie } });
    expect(nginx.headers['x-kobox-user']).toBeUndefined();
  });

  it('should_open_the_session_with_the_right_code', async () => {
    const { cookie } = await passwordOnly('boss');

    const response = await world.server.inject({
      method: 'POST',
      url: '/login/code',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ code: world.totp.freshCode() }),
    });

    expect(response.headers.location).toBe('/');
    const home = await world.server.inject({ method: 'GET', url: '/', headers: { cookie } });
    expect(home.statusCode).toBe(200);
  });

  it('should_stay_on_the_code_page_with_a_wrong_code', async () => {
    const { cookie } = await passwordOnly('boss');

    const response = await world.server.inject({
      method: 'POST',
      url: '/login/code',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ code: '000000' }),
    });

    expect(response.body).toContain('That code did not work');
  });
});

describe('admins and two-step sign-in', () => {
  // asked by an admin: an admin account opens every member's settings, so
  // the password alone must not be enough
  it('should_send_an_admin_without_it_to_set_it_up_first', async () => {
    const stored = await world.credentials.find(Username.parse('boss'));
    if (stored === undefined) {
      throw new Error('the world has an admin');
    }
    await world.credentials.save(withoutCredential(stored, 'twoStep'), '2026-10-26 10:00:00');
    const admin = await loginAs(world, 'boss');

    const response = await world.server.inject({ method: 'GET', url: '/admin/users', headers: { cookie: admin.cookie } });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toContain('/access');
  });
});

describe('setting two-step sign-in up', () => {
  it('should_show_a_secret_then_turn_it_on_with_a_first_code', async () => {
    const alice = await loginAs(world, 'alice');

    const started = await world.server.inject({
      method: 'POST',
      url: '/access/two-step/start',
      headers: { cookie: alice.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: alice.csrf }),
    });
    expect(started.body).toContain('otpauth://totp/KoBox:alice?secret=');

    await world.server.inject({
      method: 'POST',
      url: '/access/two-step/confirm',
      headers: { cookie: alice.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: alice.csrf, code: world.totp.freshCode() }),
    });

    expect((await world.credentials.find(Username.parse('alice')))?.twoStep).toBeDefined();
  });

  it('should_turn_it_off_only_with_a_current_code', async () => {
    const admin = await loginAs(world, 'boss');
    const off = (code: string) =>
      world.server.inject({
        method: 'POST',
        url: '/access/two-step/stop',
        headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ _csrf: admin.csrf, code }),
      });

    await off('000000');
    expect((await world.credentials.find(Username.parse('boss')))?.twoStep).toBeDefined();

    await off(world.totp.freshCode());
    expect((await world.credentials.find(Username.parse('boss')))?.twoStep).toBeUndefined();
  });
});
