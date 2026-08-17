import { beforeEach, describe, expect, it } from 'vitest';
import { Blocklist } from '../../../src/domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../../src/domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../../src/domain/tracker/BlocklistUrl.js';
import { InMemoryBlocklistRepository } from '../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { InMemoryTrackerRepository } from '../../../src/infrastructure/persistence/InMemoryTrackerRepository.js';
import { TrackerBuilder } from '../../builders/TrackerBuilder.js';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

let world: PortalWorld;
let admin: AgentSession;
let trackers: InMemoryTrackerRepository;
let blocklists: InMemoryBlocklistRepository;

beforeEach(async () => {
  trackers = new InMemoryTrackerRepository();
  blocklists = new InMemoryBlocklistRepository();
  world = await buildPortalWorld({ trackers, blocklists });
  admin = await loginAs(world, 'boss');
  await trackers.save(
    new TrackerBuilder().withHost('tracker.example.org').promotedUntil('2026-12-01').build(),
  );
  await trackers.save(new TrackerBuilder().withHost('dead.example.net').deadTracker().build());
  await blocklists.save(
    Blocklist.create({
      source: BlocklistSource.parse('iblocklist'),
      author: 'bluetack',
      name: 'level1',
      url: BlocklistUrl.parse('https://lists.example.net/level1.gz'),
      subscription: false,
      enabled: true,
    }),
  );
});

describe('admin trackers screen', () => {
  it('should_list_trackers_with_cert_state_for_admins', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/trackers',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('tracker.example.org');
    expect(response.body).toContain('2026-12-01');
    expect(response.body).toContain('dead.example.net');
  });

  it('should_refuse_non_admins', async () => {
    const user = await loginAs(world, 'alice');
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/trackers',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should_enqueue_mark_tracker_dead', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/trackers/mark-dead',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, host: 'tracker.example.org' }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs.map((j) => j.type)).toEqual(['mark-tracker-dead']);
  });

  it('should_enqueue_a_cert_fetch_for_one_tracker', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/trackers/fetch-cert',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, host: 'tracker.example.org' }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs.map((j) => j.type)).toEqual(['fetch-tracker-cert']);
  });

  it('should_enqueue_the_global_cert_renewal', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/trackers/renew-certs',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs[0];
    expect(job?.type).toBe('renew-tracker-certs');
    if (job?.type === 'renew-tracker-certs') {
      expect(job.payload.today).toBe('2026-07-25');
    }
  });

  it('should_reject_a_shell_shaped_host_without_enqueueing', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/trackers/mark-dead',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, host: 'evil.example.org;id' }),
    });

    expect(response.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });
});

describe('admin blocklists screen', () => {
  it('should_list_blocklists_with_their_status', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/blocklists',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('bluetack');
    expect(response.body).toContain('level1');
  });

  it('should_enqueue_update_and_catalog_import', async () => {
    const update = await world.server.inject({
      method: 'POST',
      url: '/admin/blocklists/update',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });
    const importCatalog = await world.server.inject({
      method: 'POST',
      url: '/admin/blocklists/import-catalog',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });

    expect(update.statusCode).toBe(303);
    expect(importCatalog.statusCode).toBe(303);
    expect(world.queue.jobs.map((j) => j.type)).toEqual([
      'update-blocklists',
      'import-blocklist-catalog',
    ]);
  });
});

describe('turning a blocklist on and off', () => {
  it('should_offer_a_control_per_list_rather_than_a_decorative_chip', async () => {
    await blocklists.save(
      Blocklist.create({
        source: BlocklistSource.parse('personal'),
        author: 'me',
        name: 'ads',
        url: BlocklistUrl.parse('https://lists.example/ads'),
        subscription: false,
        enabled: true,
      }),
    );

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/blocklists',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('/admin/blocklists/enabled');
    expect(response.body).toContain('name="enabled" checked');
  });

  it('should_enqueue_the_toggle_for_one_named_list', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/blocklists/enabled',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: admin.csrf,
        source: 'personal',
        author: 'me',
        name: 'ads',
      }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs.find((j) => j.type === 'set-blocklist-enabled');
    // no "enabled" field means an unticked box, which is the off case
    expect(job?.payload).toMatchObject({ source: 'personal', author: 'me', name: 'ads', enabled: false });
  });
});
