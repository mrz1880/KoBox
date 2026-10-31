import { beforeEach, describe, expect, it } from 'vitest';
import { DynDnsHost } from '../../../src/domain/security/DynDnsHost.js';
import { IpAddress } from '../../../src/domain/shared/IpAddress.js';
import { Username } from '../../../src/domain/user/Username.js';
import { InMemoryFairUseRepository } from '../../../src/infrastructure/persistence/InMemoryFairUseRepository.js';
import { InMemoryUserAddressRepository } from '../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

const alice = Username.parse('alice');
let world: PortalWorld;
let admin: AgentSession;
let addresses: InMemoryUserAddressRepository;
let fairUse: InMemoryFairUseRepository;

beforeEach(async () => {
  addresses = new InMemoryUserAddressRepository();
  fairUse = new InMemoryFairUseRepository();
  world = await buildPortalWorld({ addresses, bindings: addresses, fairUse });
  admin = await loginAs(world, 'boss');
  await addresses.add(alice, IpAddress.parse('203.0.113.9'));
  await addresses.addHostname(alice, DynDnsHost.parse('home.example.org'));
});

describe('admin addresses screen', () => {
  it('should_list_member_addresses_and_hostnames', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/addresses',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('203.0.113.9');
    expect(response.body).toContain('home.example.org');
  });

  // the web and the VPN are open to all; SSH and SFTP answer declared
  // addresses and the VPN only, and members declare their own from Account
  it('should_say_what_works_without_an_address_and_what_one_opens', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/addresses',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('The portal, ruTorrent, Nextcloud and the VPN are open to all');
    expect(response.body).toContain('SSH and SFTP answer only the addresses and hostnames below and the VPN');
    expect(response.body).toContain('href="/access"');
    expect(response.body).toContain('every port of the box');
    expect(response.body).not.toContain('closed\nby default');
  });

  it('should_enqueue_address_add_and_remove_jobs', async () => {
    const add = await world.server.inject({
      method: 'POST',
      url: '/admin/addresses/add',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, username: 'alice', ipv4: '198.51.100.7' }),
    });
    const remove = await world.server.inject({
      method: 'POST',
      url: '/admin/addresses/remove',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, username: 'alice', ipv4: '203.0.113.9' }),
    });

    expect(add.statusCode).toBe(303);
    expect(remove.statusCode).toBe(303);
    expect(world.queue.jobs.map((j) => j.type)).toEqual(['add-user-address', 'remove-user-address']);
  });

  it('should_refuse_to_add_a_private_address_but_still_let_one_be_removed', async () => {
    // one typed before this check existed must stay removable
    for (const action of ['add', 'remove']) {
      await world.server.inject({
        method: 'POST',
        url: `/admin/addresses/${action}`,
        headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: form({ _csrf: admin.csrf, username: 'alice', ipv4: '192.168.1.20' }),
      });
    }

    expect(world.queue.jobs.map((j) => j.type)).toEqual(['remove-user-address']);
  });

  it('should_enqueue_hostname_add_and_remove_jobs', async () => {
    const add = await world.server.inject({
      method: 'POST',
      url: '/admin/addresses/add-hostname',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, username: 'alice', hostname: 'dyn.example.org' }),
    });
    const remove = await world.server.inject({
      method: 'POST',
      url: '/admin/addresses/remove-hostname',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, username: 'alice', hostname: 'home.example.org' }),
    });

    expect(add.statusCode).toBe(303);
    expect(remove.statusCode).toBe(303);
    expect(world.queue.jobs.map((j) => j.type)).toEqual(['add-user-hostname', 'remove-user-hostname']);
  });

  it('should_reject_ip_literals_in_the_hostname_form', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/addresses/add-hostname',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, username: 'alice', hostname: '203.0.113.9' }),
    });

    expect(response.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });
});

describe('admin fair-use screen', () => {
  it('should_show_states_last_usage_and_recent_events', async () => {
    await fairUse.saveState(alice, { level: 'throttled', healthState: 'healthy' }, '2026-07-25 09:00:00');
    await fairUse.putSample(alice, {
      egressBytes: 123_456_789,
      ingressBytes: 42,
      sampledAt: '2026-07-25 09:55:00',
    });
    await fairUse.appendEvent(alice, 'FairUseBreached', '{"kind":"egress"}', '2026-07-25 09:00:00');

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/fair-use',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('throttled');
    expect(response.body).toContain('FairUseBreached');
    expect(response.body).toContain('<td>July 25, 2026 at 11:00 AM</td>');
    expect(response.body).toContain('alice');
  });

  it('should_say_the_last_sample_in_the_sizes_and_the_clock_of_every_other_page', async () => {
    await fairUse.putSample(alice, {
      egressBytes: 5 * 1024 ** 3,
      ingressBytes: 42,
      sampledAt: '2026-07-25 09:55:00',
    });

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/fair-use',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('<td class="num">5.0 GiB</td>');
    expect(response.body).toContain('July 25, 2026 at 11:55 AM');
  });

  it('should_say_a_member_without_a_sample_is_not_measured', async () => {
    await fairUse.saveState(alice, { level: 'none', healthState: 'healthy' }, '2026-07-25 09:00:00');

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/fair-use',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('<td class="num"><span class="muted">not measured</span></td>');
  });

  // the screen printed the stored state, healthy or unhealthy, untranslated
  it('should_say_whether_each_members_service_runs_in_the_admins_words', async () => {
    await fairUse.saveState(alice, { level: 'none', healthState: 'unhealthy' }, '2026-07-25 09:00:00');

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/fair-use',
      headers: { cookie: admin.cookie, 'accept-language': 'fr-FR' },
    });

    expect(response.body).toContain('<td><span class="chip bad">service arrêté</span></td>');
    expect(response.body).not.toContain('unhealthy');
  });

  it('should_say_no_event_was_recorded_rather_than_leave_the_heading_alone', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/fair-use',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('<p class="muted">No event recorded yet.</p>');
  });

  it('should_enqueue_an_override_job_translating_clear_to_null', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/fair-use/override',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        _csrf: admin.csrf,
        username: 'alice',
        egressLimitMbit: '100',
        authRatePerHour: 'clear',
        throttleToMbit: '',
      }),
    });

    expect(response.statusCode).toBe(303);
    const job = world.queue.jobs[0];
    expect(job?.type).toBe('set-fair-use-override');
    if (job?.type === 'set-fair-use-override') {
      expect(job.payload.egressLimitBps).toBe(100_000_000);
      expect(job.payload.authRatePerHour).toBeNull();
      expect(job.payload.throttleToBps).toBeUndefined();
    }
  });
});
