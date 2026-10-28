import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

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

  // the flash names the folders, so it cannot be a fixed sentence looked up at
  // render: it is put in the reader's language when the redirect is made
  it('should_confirm_a_rename_in_french_to_a_french_browser', async () => {
    const french = { cookie: member.cookie, 'accept-language': 'fr' };
    const renamed = await world.server.inject({
      method: 'POST',
      url: '/sync/categories/rename',
      headers: { ...french, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: member.csrf, label: 'films', to: 'Movies' }),
    });

    const response = await world.server.inject({
      method: 'GET',
      url: renamed.headers.location ?? '',
      headers: french,
    });

    expect(response.body).toContain('<div class="flash">Renommage de films en Movies.</div>');
  });
});
