import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let member: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  member = await loginAs(world, 'alice');
});

describe('the Folders page in French', () => {
  it('should_say_where_the_files_go_in_french_to_a_french_browser', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/sync',
      headers: { cookie: member.cookie, 'accept-language': 'fr' },
    });

    expect(response.body).toContain('Où vont vos fichiers');
  });
});
