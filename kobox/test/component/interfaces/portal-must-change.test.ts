import { describe, expect, it } from 'vitest';
import { Username } from '../../../src/domain/user/Username.js';
import { buildPortalWorld, loginAs, NOW, type PortalWorld } from './portalWorld.js';

// A migrated user is created with a temporary password and a forced-reset flag.
// Until they set a new password, the portal must funnel every request to
// /password and refuse the nginx auth_request that gates ruTorrent.
async function markMustChange(world: PortalWorld, username: string): Promise<void> {
  const user = Username.parse(username);
  const cred = await world.credentials.find(user);
  if (cred === undefined) {
    throw new Error('expected an existing credential');
  }
  await world.credentials.save({ ...cred, mustChangePassword: true }, NOW);
}

describe('portal forced password reset', () => {
  it('should_redirect_a_must_change_user_from_any_page_to_password', async () => {
    const world = await buildPortalWorld();
    await markMustChange(world, 'alice');
    const { cookie } = await loginAs(world, 'alice');

    const home = await world.server.inject({ method: 'GET', url: '/', headers: { cookie } });

    expect(home.statusCode).toBe(303);
    expect(home.headers.location).toBe('/password');
  });

  it('should_still_serve_the_password_page_itself', async () => {
    const world = await buildPortalWorld();
    await markMustChange(world, 'alice');
    const { cookie } = await loginAs(world, 'alice');

    const password = await world.server.inject({
      method: 'GET',
      url: '/password',
      headers: { cookie },
    });

    expect(password.statusCode).toBe(200);
  });

  it('should_deny_the_rutorrent_auth_request_until_the_password_is_set', async () => {
    const world = await buildPortalWorld();
    await markMustChange(world, 'alice');
    const { cookie } = await loginAs(world, 'alice');

    const auth = await world.server.inject({
      method: 'GET',
      url: '/internal/auth/rpc',
      headers: { cookie, 'x-original-uri': '/RPC-ALICE' },
    });

    expect(auth.statusCode).toBe(403);
  });

  it('should_not_disturb_a_user_who_is_not_flagged', async () => {
    const world = await buildPortalWorld();
    const { cookie } = await loginAs(world, 'alice');

    const home = await world.server.inject({ method: 'GET', url: '/', headers: { cookie } });

    expect(home.statusCode).toBe(200);
  });
});
