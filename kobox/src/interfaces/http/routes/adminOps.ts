import type { FastifyInstance } from 'fastify';
import type { MailOutboxPort } from '../../../application/maintenance/MailOutboxPort.js';
import type { ReleaseRepositoryPort } from '../../../application/maintenance/ReleaseRepositoryPort.js';
import type { ComponentRegistry, ComponentRecord } from '../../../domain/installation/ports.js';
import type { SpeedtestRepositoryPort } from '../../../application/maintenance/SpeedtestPort.js';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import type { HealthCheckResult, HealthProbePort, UserRepository } from '../../../domain/user/ports.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import { adminHealthPage, adminMailsPage } from '../views/adminOpsPage.js';
import { monitoringPage } from '../views/userPages.js';

export interface AdminOpsDeps {
  readonly users: UserRepository;
  readonly health: HealthProbePort;
  readonly components: ComponentRegistry;
  readonly speedtests: SpeedtestRepositoryPort;
  readonly queue: JobQueuePort;
  readonly releases: ReleaseRepositoryPort;
  readonly outbox: MailOutboxPort;
}

export function registerAdminOpsRoutes(
  server: FastifyInstance,
  deps: AdminOpsDeps,
  guards: Guards,
): void {
  // Admin-only frame around the NanoMon dashboard; nginx separately gates the
  // /monitoring/ proxy on the same admin auth_request.
  server.get('/monitoring', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    return reply.type('text/html').send(monitoringPage(viewerOf(session)));
  });

  server.get('/admin/health', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    // real probes, mirroring `kobox doctor`: rtorrent process + each active
    // user's SCGI socket (systemd "active" is not proof — AUDIT §3.7)
    const probes: HealthCheckResult[] = [await deps.health.checkProcess('rtorrent')];
    for (const user of await deps.users.listAll()) {
      if (!user.status.isSuspended()) {
        probes.push(await deps.health.checkSocket('127.0.0.1', user.scgiPort.value));
      }
    }
    const [components, releases, measurements] = await Promise.all([
      deps.components.list(),
      deps.releases.list(),
      deps.speedtests.listRecent(10),
    ]);
    // the button is offered only when the binary is actually installed
    const available = components.some(
      (component: ComponentRecord) =>
        String(component.name) === 'speedtest' && String(component.state) === 'installed',
    );
    return reply
      .type('text/html')
      .send(
        adminHealthPage(
          probes,
          components,
          releases,
          viewerOf(session),
          measurements,
          available,
          flashOf(request),
        ),
      );
  });

  server.post('/admin/speedtest', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    // enqueueUnique: a double click must not stack two link-saturating runs
    const id = await deps.queue.enqueueUnique(buildJob.runSpeedtest());
    return redirectWithFlash(
      reply,
      '/admin/health',
      id === undefined ? 'A measurement is already running.' : 'Measuring the link.',
    );
  });

  server.get('/admin/mails', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const mails = await deps.outbox.listRecent(50);
    return reply
      .type('text/html')
      .send(adminMailsPage(mails, viewerOf(session), flashOf(request)));
  });
}
