import { describe, expect, it } from 'vitest';
import { NOW, buildPortalWorld, loginAs } from './portalWorld.js';
import { ComponentName } from '../../../src/domain/installation/ComponentName.js';
import { InMemoryComponentRegistry } from '../../../src/infrastructure/persistence/InMemoryComponentRegistry.js';

// The NanoMon dashboard is admin-only: the portal page that frames it requires
// the admin role, and nginx separately gates the /monitoring/ proxy on the same
// admin auth_request. A plain user must never reach it.
describe('portal monitoring (admin-only)', () => {
  it('should_frame_the_monitoring_dashboard_for_an_admin', async () => {
    // the frame is only offered when there is something behind it
    const components = new InMemoryComponentRegistry();
    await components.markInstalled(ComponentName.parse('nanomon'), undefined, NOW);
    const world = await buildPortalWorld({ components });
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

describe('when monitoring is not there', () => {
  it('should_say_what_is_missing_instead_of_framing_a_404', async () => {
    // The nav offers this screen unconditionally. With no NanoMon release
    // pinned the component skips honestly, and an admin who clicks got an empty
    // frame with a 404 inside it and nothing to act on.
    const world = await buildPortalWorld({ components: new InMemoryComponentRegistry() });
    const admin = await loginAs(world, 'boss');

    const response = await world.server.inject({
      method: 'GET',
      url: '/monitoring',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('KOBOX_NANOMON_URL');
    expect(response.body).not.toContain('<iframe');
  });
});
