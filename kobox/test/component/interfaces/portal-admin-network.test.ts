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
    expect(response.body).toContain('alice');
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
