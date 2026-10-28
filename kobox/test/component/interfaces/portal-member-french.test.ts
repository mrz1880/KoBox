import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let member: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  member = await loginAs(world, 'alice');
});

describe("a member's pages in French", () => {
  // the button a member reaches for when ruTorrent hangs was the one line
  // still in English on the page they open most
  it('should_offer_the_rtorrent_restart_in_french_to_a_french_browser', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/rutorrent',
      headers: { cookie: member.cookie, 'accept-language': 'fr' },
    });

    expect(response.body).toContain('Redémarrer mon rtorrent');
  });
});
