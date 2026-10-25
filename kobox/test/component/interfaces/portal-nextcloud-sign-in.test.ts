import { beforeEach, describe, expect, it } from 'vitest';
import { Username } from '../../../src/domain/user/Username.js';
import { buildPortalWorld, loginAs, NOW, TEST_PASSWORD, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;

beforeEach(async () => {
  world = await buildPortalWorld();
});

// nginx asks this before every Nextcloud request and passes the name it gets to
// Nextcloud, which then opens that member's session without asking again
async function whoIsSignedIn(headers: Record<string, string> = {}) {
  return world.server.inject({ method: 'GET', url: '/internal/auth/session', headers });
}

function basic(user: string, secret: string): string {
  return `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
}

describe('who is signed in to the portal, for Nextcloud', () => {
  it('should_name_the_member_signed_in_to_the_portal', async () => {
    const { cookie } = await loginAs(world, 'alice');

    const response = await whoIsSignedIn({ cookie });

    expect(response.statusCode).toBe(204);
    expect(response.headers['x-kobox-user']).toBe('alice');
  });

  // never a refusal: Nextcloud's own sign-in page and its apps must still load
  it('should_let_a_visitor_without_a_session_through_unnamed', async () => {
    const response = await whoIsSignedIn();

    expect(response.statusCode).toBe(204);
    expect(response.headers['x-kobox-user']).toBeUndefined();
  });

  // the Nextcloud apps send their own credentials: a name in them proves nothing
  it('should_take_no_name_from_credentials_a_client_sends', async () => {
    const response = await whoIsSignedIn({ authorization: basic('alice', TEST_PASSWORD) });

    expect(response.statusCode).toBe(204);
    expect(response.headers['x-kobox-user']).toBeUndefined();
  });

  it('should_name_nobody_before_a_forced_password_change_is_done', async () => {
    const { cookie } = await loginAs(world, 'alice');
    const alice = await world.credentials.find(Username.parse('alice'));
    if (alice === undefined) throw new Error('alice has no portal login');
    await world.credentials.save({ ...alice, mustChangePassword: true }, NOW);

    const response = await whoIsSignedIn({ cookie });

    expect(response.headers['x-kobox-user']).toBeUndefined();
  });
});
