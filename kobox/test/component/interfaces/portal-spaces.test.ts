import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;
let member: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  admin = await loginAs(world, 'boss');
  member = await loginAs(world, 'alice');
});

async function get(url: string, session: AgentSession) {
  return world.server.inject({ method: 'GET', url, headers: { cookie: session.cookie } });
}

// the hrefs of one labelled <nav>, in order; [] when the page has none
function linksOf(body: string, label: string): string[] {
  const nav = new RegExp(`<nav aria-label="${label}">([\\s\\S]*?)</nav>`).exec(body);
  return [...(nav?.[1] ?? '').matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? '');
}

const SEEDBOX_MENU = ['/', '/rutorrent', '/files', '/media', '/sync', '/downloads', '/access'];
const ADMIN_MENU = [
  '/admin',
  '/admin/users',
  '/admin/network',
  '/admin/system',
  '/admin/health',
  '/admin/troubleshooting',
];

describe('the two spaces of the portal', () => {
  it('should_give_a_member_the_seedbox_menu_and_no_way_into_administration', async () => {
    const body = (await get('/', member)).body;

    expect(linksOf(body, 'Menu')).toEqual(SEEDBOX_MENU);
    expect(linksOf(body, 'Space')).toEqual([]);
  });

  // an admin is a member too: replacing their menu with the administration one
  // hid their own files, folders and account
  it('should_give_an_admin_the_same_seedbox_and_a_switch_to_administration', async () => {
    const body = (await get('/', admin)).body;

    expect(body).toContain('Hello boss');
    expect(linksOf(body, 'Menu')).toEqual(SEEDBOX_MENU);
    expect(linksOf(body, 'Space')).toEqual(['/', '/admin']);
  });

  it('should_open_administration_on_the_overview_with_its_own_menu', async () => {
    const response = await get('/admin', admin);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Fleet console');
    expect(linksOf(response.body, 'Menu')).toEqual(ADMIN_MENU);
  });

  it('should_keep_the_administration_menu_on_every_administration_page', async () => {
    const body = (await get('/admin/users', admin)).body;

    expect(linksOf(body, 'Menu')).toEqual(ADMIN_MENU);
  });

  it('should_keep_a_member_out_of_the_overview', async () => {
    expect((await get('/admin', member)).statusCode).not.toBe(200);
  });
});
