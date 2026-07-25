import type { FastifyInstance } from 'fastify';
import type { MailOutboxPort } from '../../../application/maintenance/MailOutboxPort.js';
import type { ReleaseRepositoryPort } from '../../../application/maintenance/ReleaseRepositoryPort.js';
import type { ComponentRegistry } from '../../../domain/installation/ports.js';
import type { HealthCheckResult, HealthProbePort, UserRepository } from '../../../domain/user/ports.js';
import { flashOf, viewerOf, type Guards } from '../guards.js';
import { adminHealthPage, adminMailsPage } from '../views/adminOpsPage.js';

export interface AdminOpsDeps {
  readonly users: UserRepository;
  readonly health: HealthProbePort;
  readonly components: ComponentRegistry;
  readonly releases: ReleaseRepositoryPort;
  readonly outbox: MailOutboxPort;
}

export function registerAdminOpsRoutes(
  server: FastifyInstance,
  deps: AdminOpsDeps,
  guards: Guards,
): void {
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
    const [components, releases] = await Promise.all([
      deps.components.list(),
      deps.releases.list(),
    ]);
    return reply
      .type('text/html')
      .send(adminHealthPage(probes, components, releases, viewerOf(session), flashOf(request)));
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
