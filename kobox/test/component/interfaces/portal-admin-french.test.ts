import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  admin = await loginAs(world, 'boss');
});

describe('the administration console in French', () => {
  it('should_describe_the_configuration_files_in_french_to_a_french_browser', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/config',
      headers: { cookie: admin.cookie, 'accept-language': 'fr' },
    });

    expect(response.body).toContain('Ce qu’il décide');
  });

  it('should_refuse_a_member_in_french_to_a_french_browser', async () => {
    const member = await loginAs(world, 'alice');

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: member.cookie, 'accept-language': 'fr' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('<html lang="fr">');
    expect(response.body).toContain('Cet espace est réservé aux administrateurs.');
  });
});
