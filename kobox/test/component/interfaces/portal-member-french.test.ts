import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

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

    expect(response.body).toContain('Redémarrer mon rTorrent');
  });

  // the reason is the domain's own words; the sentence around it is the page's
  it('should_refuse_a_new_password_in_french_to_a_french_browser', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/password',
      headers: {
        cookie: member.cookie,
        'accept-language': 'fr',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: form({ _csrf: member.csrf, current: '8chars!!', next: 'x'.repeat(101) }),
    });

    expect(response.body).toContain('Choisissez un autre mot de passe (');
  });
});
