import { beforeEach, describe, expect, it } from 'vitest';
import { Label } from '../../../src/domain/torrent/Label.js';
import { SyncMode } from '../../../src/domain/torrent/SyncMode.js';
import { Username } from '../../../src/domain/user/Username.js';
import {
  buildPortalWorld,
  form,
  loginAs,
  TEST_PASSWORD,
  type AgentSession,
  type PortalWorld,
} from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;
let member: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  admin = await loginAs(world, 'boss');
  member = await loginAs(world, 'alice');
});

async function savedMessage(
  session: AgentSession,
  url: string,
  fields: Record<string, string>,
): Promise<string | null> {
  const response = await world.server.inject({
    method: 'POST',
    url,
    headers: { cookie: session.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: form({ _csrf: session.csrf, ...fields }),
  });
  return new URL(String(response.headers.location), 'https://box.example.org').searchParams.get(
    'flash',
  );
}

const KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7Kk1p2vQ0Hn3xYqZ8mLsRtWuVdEfGhIjKlMnOpQrSt nas';

// The portal now waits for the worker before answering, and a change still
// under way is announced as such by the page itself: the message a save
// carries is shown only once the change is applied, so it says it is done.
describe('the message a save shows once the worker applied it', () => {
  it.each([
    ['/admin/mail-relay', { host: 'smtp.example.org', port: '587', user: 'postmaster@example.org', password: 'relay-secret-42' }, 'Relay saved and applied.'],
    ['/admin/addresses/add', { username: 'alice', ipv4: '198.51.100.7' }, 'Address added.'],
    ['/admin/addresses/remove', { username: 'alice', ipv4: '198.51.100.7' }, 'Address removed.'],
    ['/admin/services/restart', { service: 'nginx' }, 'nginx restarted.'],
    ['/admin/logs/capture', { service: 'kobox-worker' }, 'kobox-worker journal captured.'],
    ['/admin/trackers/fetch-cert', { host: 'tracker.example.org' }, 'tracker.example.org updated.'],
    ['/admin/trackers/renew-certs', {}, 'Certificates renewed.'],
    ['/admin/blocklists/update', {}, 'Blocklists updated.'],
    ['/admin/blocklists/import-catalog', {}, 'Catalog imported.'],
    ['/admin/users/alice/suspend', {}, 'alice suspended.'],
    ['/admin/users/alice/resume', {}, 'alice restored.'],
    ['/admin/users/alice/delete', {}, 'alice deleted.'],
  ])('should_confirm_%s_as_done', async (url, fields, message) => {
    expect(await savedMessage(admin, url, fields)).toBe(message);
  });

  it.each([
    ['/password', { current: TEST_PASSWORD, next: 'a-new-password-42' }, 'Password changed.'],
    ['/access/ssh-key', { key: KEY }, 'Key installed.'],
    ['/rutorrent/restart', {}, 'Your rTorrent restarted.'],
    ['/sync/categories', { label: 'series' }, 'series folder created.'],
    ['/sync/categories/remove', { label: 'films' }, 'films folder removed.'],
    ['/sync/categories/rename', { label: 'films', to: 'Movies' }, 'films renamed to Movies.'],
  ])('should_confirm_%s_as_done', async (url, fields, message) => {
    expect(await savedMessage(member, url, fields)).toBe(message);
  });

  it('should_confirm_what_a_sending_folder_already_held_as_queued', async () => {
    const instance = await world.instances.findByUsername(Username.parse('alice'));
    if (instance === undefined) {
      throw new Error('the world should have provisioned alice');
    }
    await world.instances.save(instance.setSyncMode(Label.parse('films'), SyncMode.parse('scheduled')));

    expect(await savedMessage(member, '/sync/categories/send-existing', { label: 'films' })).toBe(
      'What films already held is queued. Anything already sent stays as it is.',
    );
  });
});
