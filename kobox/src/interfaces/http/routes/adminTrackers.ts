import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import type { BlocklistRepository, TrackerRepository } from '../../../domain/tracker/ports.js';
import { TrackerHost } from '../../../domain/tracker/TrackerHost.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import { adminBlocklistsPage, adminTrackersPage } from '../views/adminTrackersPage.js';

// The VO is the validator: a host the domain refuses never becomes a payload.
const hostSchema = z.object({
  host: z
    .string()
    .max(253)
    .refine((raw) => {
      try {
        TrackerHost.parse(raw);
        return true;
      } catch {
        return false;
      }
    }),
});

export interface AdminTrackersDeps {
  readonly trackers: TrackerRepository;
  readonly blocklists: BlocklistRepository;
  readonly queue: JobQueuePort;
  readonly now: () => string;
}

export function registerAdminTrackerRoutes(
  server: FastifyInstance,
  deps: AdminTrackersDeps,
  guards: Guards,
): void {
  server.get('/admin/trackers', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const trackers = await deps.trackers.listAll();
    return reply
      .type('text/html')
      .send(adminTrackersPage(trackers, viewerOf(session), flashOf(request)));
  });

  const hostActions = [
    ['mark-dead', (host: string) => buildJob.markTrackerDead({ host })],
    ['fetch-cert', (host: string) => buildJob.fetchTrackerCert({ host })],
  ] as const;

  for (const [action, build] of hostActions) {
    server.post(`/admin/trackers/${action}`, async (request, reply) => {
      const session = await guards.requireAdminCsrf(request, reply);
      if (session === undefined) {
        return;
      }
      const parsed = hostSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send();
      }
      await deps.queue.enqueue(build(parsed.data.host));
      return redirectWithFlash(reply, '/admin/trackers', `Updating ${parsed.data.host}.`);
    });
  }

  server.post('/admin/trackers/renew-certs', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const today = deps.now().slice(0, 10);
    await deps.queue.enqueue(buildJob.renewTrackerCerts({ today }));
    return redirectWithFlash(reply, '/admin/trackers', 'Renewing certificates.');
  });

  server.get('/admin/blocklists', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const blocklists = await deps.blocklists.listAll();
    return reply
      .type('text/html')
      .send(adminBlocklistsPage(blocklists, viewerOf(session), flashOf(request)));
  });

  server.post('/admin/blocklists/update', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    await deps.queue.enqueue(buildJob.updateBlocklists());
    return redirectWithFlash(reply, '/admin/blocklists', 'Updating blocklists.');
  });

  server.post('/admin/blocklists/import-catalog', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    await deps.queue.enqueue(buildJob.importBlocklistCatalog());
    return redirectWithFlash(reply, '/admin/blocklists', 'Importing the catalog.');
  });
}
