import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;
let user: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  admin = await loginAs(world, 'boss');
  user = await loginAs(world, 'alice');
});

describe('public name and certificate', () => {
  it('should_store_the_public_name_and_the_address_notices_go_to', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/domain',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: admin.csrf,
        domain: 'seedbox.example.org',
        email: 'admin@example.org',
      }),
    });

    expect(response.statusCode).toBe(303);
    const stored = await world.siteSettings.get();
    expect(stored?.domain).toBe('seedbox.example.org');
    expect(stored?.email).toBe('admin@example.org');
  });

  it('should_refuse_something_that_is_not_a_hostname', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/domain',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: admin.csrf,
        domain: 'https://seedbox.example.org/',
        email: 'admin@example.org',
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(await world.siteSettings.get()).toBeUndefined();
  });

  it('should_show_what_is_stored_and_say_what_still_has_to_happen', async () => {
    await world.siteSettings.save({ domain: 'seedbox.example.org', email: 'admin@example.org' });

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/domain',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('seedbox.example.org');
    // storing a name issues no certificate: the page must not imply it did
    expect(response.body).toContain('kobox install');
  });

  it('should_refuse_a_non_admin', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/domain',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(403);
  });
});
