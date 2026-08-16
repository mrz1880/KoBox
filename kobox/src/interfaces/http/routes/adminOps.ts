import type { FastifyInstance } from 'fastify';
import type { MailOutboxPort } from '../../../application/maintenance/MailOutboxPort.js';
import type { ReleaseRepositoryPort } from '../../../application/maintenance/ReleaseRepositoryPort.js';
import type { ComponentRegistry, ComponentRecord } from '../../../domain/installation/ports.js';
import type { SpeedtestRepositoryPort } from '../../../application/maintenance/SpeedtestPort.js';
import type { ConfigFileReaderPort } from '../../../application/installation/ConfigFileReaderPort.js';
import type {
  DiagnosticsRepositoryPort,
  ServiceLogSnapshot,
} from '../../../application/maintenance/DiagnosticsPort.js';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import type { HealthCheckResult, HealthProbePort, UserRepository } from '../../../domain/user/ports.js';
import { z } from 'zod';
import { LoggableService, ManagedService } from '../../../domain/maintenance/ManagedService.js';
import { ConfigDocument } from '../../../domain/installation/ConfigDocument.js';
import { DomainError } from '../../../domain/shared/DomainError.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import { adminHealthPage, adminMailsPage } from '../views/adminOpsPage.js';
import { adminLogsPage, adminPackagesPage } from '../views/adminDiagnosticsPage.js';
import { adminConfigPage } from '../views/adminConfigPage.js';
import { monitoringPage } from '../views/userPages.js';

export interface AdminOpsDeps {
  readonly users: UserRepository;
  readonly health: HealthProbePort;
  readonly components: ComponentRegistry;
  readonly speedtests: SpeedtestRepositoryPort;
  readonly queue: JobQueuePort;
  readonly releases: ReleaseRepositoryPort;
  readonly outbox: MailOutboxPort;
  readonly diagnostics: DiagnosticsRepositoryPort;
  readonly configFiles: ConfigFileReaderPort;
}

const serviceSchema = z.object({ service: z.string().min(1).max(64) });
// the query carries an id from a closed catalog, never a path
const configQuerySchema = z.object({ file: z.string().min(1).max(64).optional() });

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
    // the same registry the Health screen reads: one truth about what is on
    // the box, rather than a second opinion baked into this page
    const installed = (await deps.components.list()).some(
      (component: ComponentRecord) =>
        String(component.name) === 'nanomon' && String(component.state) === 'installed',
    );
    return reply.type('text/html').send(monitoringPage(viewerOf(session), installed));
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

  server.post('/admin/services/restart', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = serviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    // parsed against the closed set here too: an unknown unit never becomes a job
    let service: ManagedService;
    try {
      service = ManagedService.parse(parsed.data.service);
    } catch (error) {
      if (error instanceof DomainError) {
        return reply.code(400).send();
      }
      throw error;
    }
    await deps.queue.enqueue(buildJob.restartService({ service: service.value }));
    return redirectWithFlash(reply, '/admin/health', `Restarting ${service.value}.`);
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

  server.get('/admin/logs', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const found = await Promise.all(
      LoggableService.all().map((unit) => deps.diagnostics.findLog(unit)),
    );
    const snapshots = found.filter(
      (snapshot): snapshot is ServiceLogSnapshot => snapshot !== undefined,
    );
    return reply
      .type('text/html')
      .send(adminLogsPage(snapshots, viewerOf(session), flashOf(request)));
  });

  server.post('/admin/logs/capture', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = serviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    // same closed-set discipline as the restart: journalctl never sees a unit
    // name that did not survive the domain type
    let service: LoggableService;
    try {
      service = LoggableService.parse(parsed.data.service);
    } catch (error) {
      if (error instanceof DomainError) {
        return reply.code(400).send();
      }
      throw error;
    }
    await deps.queue.enqueue(buildJob.captureServiceLog({ service: service.value }));
    return redirectWithFlash(reply, '/admin/logs', `Capturing the ${service.value} journal.`);
  });

  server.get('/admin/packages', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const snapshot = await deps.diagnostics.findPackages();
    return reply
      .type('text/html')
      .send(adminPackagesPage(snapshot, viewerOf(session), flashOf(request)));
  });

  server.post('/admin/packages/check', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    // enqueueUnique: apt takes a lock, so a second check would only sit and wait
    const id = await deps.queue.enqueueUnique(buildJob.checkPackageUpdates());
    return redirectWithFlash(
      reply,
      '/admin/packages',
      id === undefined ? 'A check is already running.' : 'Checking for updates.',
    );
  });

  server.post('/admin/packages/apply', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const id = await deps.queue.enqueueUnique(buildJob.applyPackageUpdates());
    return redirectWithFlash(
      reply,
      '/admin/packages',
      id === undefined ? 'An update is already running.' : 'Installing the updates.',
    );
  });

  server.get('/admin/config', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = configQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    let selected: ConfigDocument | undefined;
    if (parsed.data.file !== undefined) {
      try {
        selected = ConfigDocument.parse(parsed.data.file);
      } catch (error) {
        if (error instanceof DomainError) {
          return reply.code(400).send();
        }
        throw error;
      }
    }
    const found = selected === undefined ? undefined : await deps.configFiles.read(selected);
    return reply.type('text/html').send(adminConfigPage(selected, found, viewerOf(session)));
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
