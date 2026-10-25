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

// the links a page offers inside its content, the menus left out
function contentLinks(body: string): string[] {
  const main = /<main>([\s\S]*?)<\/main>/.exec(body)?.[1] ?? '';
  return [...main.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? '');
}

// Fifteen entries lined up in the bar became six; the pages behind them are
// grouped by the job an admin comes to do, each with what it is for
const GROUPS = [
  ['/admin/network', ['/admin/addresses', '/admin/trackers', '/admin/blocklists', '/admin/fair-use']],
  ['/admin/system', ['/admin/mail-relay', '/admin/mails', '/admin/domain', '/admin/packages']],
  ['/admin/troubleshooting', ['/admin/logs', '/admin/config']],
] as const;

describe('the administration groups', () => {
  it.each(GROUPS)('should_lead_from_%s_to_each_of_its_pages', async (group, pages) => {
    const response = await get(group, admin);

    expect(response.statusCode).toBe(200);
    expect(contentLinks(response.body)).toEqual(pages);
  });

  it.each(GROUPS)('should_keep_a_member_out_of_%s', async (group) => {
    expect((await get(group, member)).statusCode).not.toBe(200);
  });

  // a box runs fine without any: the page made them look required
  it('should_say_trusted_addresses_are_optional', async () => {
    const body = (await get('/admin/network', admin)).body;

    expect(body).toContain('Optional');
  });

  it('should_say_nothing_on_troubleshooting_changes_the_box', async () => {
    const body = (await get('/admin/troubleshooting', admin)).body;

    expect(body).toContain('Nothing here changes the box');
  });
});
