import { beforeEach, describe, expect, it } from 'vitest';
import type { HealthCheckResult, HealthProbePort } from '../../../src/domain/user/ports.js';
import { ComponentName } from '../../../src/domain/installation/ComponentName.js';
import { Version } from '../../../src/domain/installation/Version.js';
import { InMemoryComponentRegistry } from '../../../src/infrastructure/persistence/InMemoryComponentRegistry.js';
import { InMemoryReleaseRepository } from '../../../src/infrastructure/persistence/InMemoryReleaseRepository.js';
import { buildPortalWorld, form, loginAs, type AgentSession, type PortalWorld } from './portalWorld.js';

// Fake probe: healthy unless a name/port is registered as down.
class FakeHealthProbe implements HealthProbePort {
  private readonly downProcesses = new Set<string>();
  private readonly downPorts = new Set<number>();

  markProcessDown(name: string): void {
    this.downProcesses.add(name);
  }

  markPortDown(port: number): void {
    this.downPorts.add(port);
  }

  checkProcess(processName: string): Promise<HealthCheckResult> {
    return Promise.resolve({
      name: processName,
      state: this.downProcesses.has(processName) ? 'unhealthy' : 'healthy',
    });
  }

  checkSocket(host: string, port: number): Promise<HealthCheckResult> {
    return Promise.resolve({
      name: `${host}:${port}`,
      state: this.downPorts.has(port) ? 'unhealthy' : 'healthy',
    });
  }
}

let world: PortalWorld;
let admin: AgentSession;
let health: FakeHealthProbe;
let components: InMemoryComponentRegistry;
let releases: InMemoryReleaseRepository;

beforeEach(async () => {
  health = new FakeHealthProbe();
  components = new InMemoryComponentRegistry();
  releases = new InMemoryReleaseRepository();
  world = await buildPortalWorld({ health, components, releases });
  admin = await loginAs(world, 'boss');
  await components.markInstalled(
    ComponentName.parse('nginx'),
    Version.parse('1.22.0'),
    '2026-07-25 09:00:00',
  );
  await components.markSkipped(ComponentName.parse('dnscrypt'), 'not packaged', '2026-07-25 09:00:00');
});

describe('admin health screen', () => {
  it('should_refuse_non_admins', async () => {
    const user = await loginAs(world, 'alice');
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/health',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should_show_service_probes_and_component_registry', async () => {
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/health',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('rtorrent');
    expect(response.body).toContain('nginx');
    expect(response.body).toContain('1.22.0');
    expect(response.body).toContain('not packaged');
  });

  it('should_surface_an_unhealthy_probe', async () => {
    health.markProcessDown('rtorrent');

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/health',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('unhealthy');
  });

  it('should_list_the_releases_ledger', async () => {
    const id = await releases.record('v1.2.0', '/opt/kobox/releases/abc', '2026-07-25 08:00:00');
    await releases.setState(id, 'current', '2026-07-25 08:05:00');

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/health',
      headers: { cookie: admin.cookie },
    });

    expect(response.body).toContain('v1.2.0');
    expect(response.body).toContain('current');
  });
});

describe('admin mails screen', () => {
  it('should_list_recent_outbox_mails', async () => {
    await world.outbox.enqueue(
      { recipient: 'boss@example.org', subject: 'KoBox alert', body: 'fair-use breach' },
      '2026-07-25 09:30:00',
    );

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/mails',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('boss@example.org');
    expect(response.body).toContain('KoBox alert');
    expect(response.body).toContain('pending');
  });

  it('should_refuse_non_admins', async () => {
    const user = await loginAs(world, 'alice');
    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/mails',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('managed services', () => {
  it('should_enqueue_a_restart_for_a_unit_kobox_manages', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/services/restart',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, service: 'nginx' }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs[0]).toEqual({
      type: 'restart-service',
      payload: { service: 'nginx' },
    });
  });

  it('should_refuse_a_unit_outside_the_closed_set', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/services/restart',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, service: 'sshd' }),
    });

    // rejected before it can become a job — an arbitrary unit never reaches systemctl
    expect(response.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_refuse_a_non_admin', async () => {
    const user = await loginAs(world, 'alice');

    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/services/restart',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf, service: 'nginx' }),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toHaveLength(0);
  });
});

describe('service logs', () => {
  it('should_enqueue_a_capture_for_a_unit_in_the_closed_set', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/logs/capture',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, service: 'kobox-worker' }),
    });

    expect(response.statusCode).toBe(303);
    // the worker is readable even though it is not restartable from the portal
    expect(world.queue.jobs[0]).toEqual({
      type: 'capture-service-log',
      payload: { service: 'kobox-worker' },
    });
  });

  it('should_refuse_a_unit_outside_the_closed_set', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/logs/capture',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf, service: 'sshd' }),
    });

    expect(response.statusCode).toBe(400);
    expect(world.queue.jobs).toHaveLength(0);
  });

  it('should_show_the_captured_excerpt_with_its_capture_time', async () => {
    await world.diagnostics.saveLog({
      unit: 'nginx',
      content: '2026-08-08T10:00:00 nginx: worker process exited',
      capturedAt: '2026-08-08 10:01:00',
    });

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/logs',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('worker process exited');
    // a stale excerpt must be visibly stale
    expect(response.body).toContain('2026-08-08 10:01:00');
  });

  it('should_refuse_a_non_admin', async () => {
    const user = await loginAs(world, 'alice');

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/logs',
      headers: { cookie: user.cookie },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('package updates', () => {
  it('should_enqueue_a_check', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/packages/check',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs[0]).toEqual({ type: 'check-package-updates', payload: {} });
  });

  it('should_enqueue_an_apply_separately_from_the_check', async () => {
    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/packages/apply',
      headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: admin.csrf }),
    });

    expect(response.statusCode).toBe(303);
    expect(world.queue.jobs[0]).toEqual({ type: 'apply-package-updates', payload: {} });
  });

  it('should_show_the_last_listing_and_when_it_was_taken', async () => {
    await world.diagnostics.savePackages({
      listing: 'openssl/stable 3.0.15 upgradable from 3.0.14',
      upgradableCount: 1,
      checkedAt: '2026-08-08 09:00:00',
    });

    const response = await world.server.inject({
      method: 'GET',
      url: '/admin/packages',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('openssl/stable');
    expect(response.body).toContain('2026-08-08 09:00:00');
  });

  it('should_refuse_a_non_admin', async () => {
    const user = await loginAs(world, 'alice');

    const response = await world.server.inject({
      method: 'POST',
      url: '/admin/packages/apply',
      headers: { cookie: user.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({ _csrf: user.csrf }),
    });

    expect(response.statusCode).toBe(403);
    expect(world.queue.jobs).toHaveLength(0);
  });
});
