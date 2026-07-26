import { describe, expect, it } from 'vitest';
import { buildPortalWorld, loginAs } from './portalWorld.js';

// The NanoMon dashboard is admin-only: the portal page that frames it requires
// the admin role, and nginx separately gates the /monitoring/ proxy on the same
// admin auth_request. A plain user must never reach it.
describe('portal monitoring (admin-only)', () => {
  it('should_frame_the_monitoring_dashboard_for_an_admin', async () => {
    const world = await buildPortalWorld();
    const { cookie } = await loginAs(world, 'boss');

    const response = await world.server.inject({
      method: 'GET',
      url: '/monitoring',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('src="/monitoring/"');
  });

  it('should_forbid_a_plain_user', async () => {
    const world = await buildPortalWorld();
    const { cookie } = await loginAs(world, 'alice');

    const response = await world.server.inject({
      method: 'GET',
      url: '/monitoring',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });
});
