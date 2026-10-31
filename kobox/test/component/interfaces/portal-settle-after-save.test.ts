import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;

beforeEach(async () => {
  world = await buildPortalWorld();
  admin = await loginAs(world, 'boss');
});

async function saveQuota(): Promise<URL> {
  const response = await world.server.inject({
    method: 'POST',
    url: '/admin/users/alice/quota',
    headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: form({ _csrf: admin.csrf, quotaGib: '900' }),
  });
  return new URL(String(response.headers.location), 'https://box.example.org');
}

async function follow(location: URL, language = 'en'): Promise<{ body: string; refresh: unknown }> {
  const response = await world.server.inject({
    method: 'GET',
    url: `${location.pathname}${location.search}`,
    headers: { cookie: admin.cookie, 'accept-language': language },
  });
  return { body: response.body, refresh: response.headers.refresh };
}

// The portal hands each change to the worker. Redirecting at once showed the
// page as it was before the change, under a message saying it was done.
describe('a page reached right after a save', () => {
  it('should_show_the_change_once_the_worker_applied_it_within_the_wait', async () => {
    world.queue.workerLeavesJobs('done');

    const location = await saveQuota();

    expect(location.searchParams.get('job')).toBeNull();
    expect((await follow(location)).body).toContain('alice now has 900 GiB. Nobody else is affected.');
  });

  it('should_say_the_change_is_in_progress_and_refresh_while_the_worker_has_not_applied_it', async () => {
    world.queue.workerLeavesJobs('pending');

    const page = await follow(await saveQuota());

    expect(page.body).toContain('Saving your change. This page refreshes by itself until it is done.');
    expect(page.body).not.toContain('alice now has 900 GiB');
    expect(page.refresh).toBeDefined();
  });

  it('should_show_the_saved_message_once_the_refreshed_page_finds_the_change_applied', async () => {
    world.queue.workerLeavesJobs('pending');
    const location = await saveQuota();
    world.queue.workerLeavesJobs('done');

    const page = await follow(location);

    expect(page.body).toContain('alice now has 900 GiB. Nobody else is affected.');
    expect(page.refresh).toBeUndefined();
  });

  it('should_say_the_change_failed_when_the_worker_gave_up_on_it', async () => {
    world.queue.workerLeavesJobs('failed');

    const page = await follow(await saveQuota());

    expect(page.body).toContain('This change could not be applied. An administrator can find why under Troubleshooting.');
    expect(page.body).not.toContain('alice now has 900 GiB');
    expect(page.refresh).toBeUndefined();
  });

  it('should_say_the_change_is_in_progress_or_failed_in_french', async () => {
    world.queue.workerLeavesJobs('pending');
    const pending = await follow(await saveQuota(), 'fr-FR');
    world.queue.workerLeavesJobs('failed');
    const failed = await follow(await saveQuota(), 'fr-FR');

    expect(pending.body).toContain('Enregistrement en cours. Cette page se recharge toute seule jusqu’à ce que ce soit fait.');
    expect(failed.body).toContain(
      'Ce changement n’a pas pu être appliqué. Un administrateur en trouvera la raison dans Dépannage.',
    );
  });
});
