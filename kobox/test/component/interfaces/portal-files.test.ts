import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentName } from '../../../src/domain/installation/ComponentName.js';
import { buildPortalWorld, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let member: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  member = await loginAs(world, 'alice');
});

async function filesPage() {
  return world.server.inject({ method: 'GET', url: '/files', headers: { cookie: member.cookie } });
}

describe('the My files page', () => {
  // Nextcloud was installed and nowhere to be found in the portal
  it('should_lead_to_nextcloud_with_the_portal_login', async () => {
    await world.components.markInstalled(
      ComponentName.parse('nextcloud'),
      undefined,
      '2026-10-25 12:00:00',
    );

    const response = await filesPage();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('href="/nextcloud/"');
    expect(response.body).toContain('alice');
  });

  it('should_say_nextcloud_is_missing_rather_than_link_to_nothing', async () => {
    const body = (await filesPage()).body;

    expect(body).not.toContain('href="/nextcloud/"');
    expect(body).toContain('Nextcloud is not installed on this box');
  });

  // the share is the member's home, at the box's address in the usual tunnel
  it('should_give_the_network_share_at_the_box_address_in_the_vpn', async () => {
    const body = (await filesPage()).body;

    expect(body).toContain('smb://10.0.0.1/alice');
  });

  // without a configured name, the name the portal was opened by is the box
  it('should_give_the_sftp_address_by_the_name_the_portal_was_reached_by', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/files',
      headers: { cookie: member.cookie, host: 'box.example.net' },
    });

    expect(response.body).toContain('sftp://alice@box.example.net');
  });
});
