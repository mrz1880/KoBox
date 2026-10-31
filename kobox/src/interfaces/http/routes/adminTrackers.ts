import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AwaitJob } from '../../../application/jobs/AwaitJob.js';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import type { BlocklistRepository, TrackerRepository } from '../../../domain/tracker/ports.js';
import { TrackerHost } from '../../../domain/tracker/TrackerHost.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, viewerOf, type Guards, redirectOnceApplied } from '../guards.js';
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
  readonly awaitJob: AwaitJob;
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
      .send(adminTrackersPage(trackers, viewerOf(session, request), flashOf(request)));
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
      const job = await deps.queue.enqueue(build(parsed.data.host));
      return redirectOnceApplied(reply, deps.awaitJob, job,
        '/admin/trackers',
        viewerOf(session, request).t('{host} updated.', { host: parsed.data.host }),
      );
    });
  }

  server.post('/admin/trackers/renew-certs', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const today = deps.now().slice(0, 10);
    const job = await deps.queue.enqueue(buildJob.renewTrackerCerts({ today }));
    return redirectOnceApplied(reply, deps.awaitJob, job, '/admin/trackers', 'Certificates renewed.');
  });

  server.get('/admin/blocklists', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const blocklists = await deps.blocklists.listAll();
    return reply
      .type('text/html')
      .send(adminBlocklistsPage(blocklists, viewerOf(session, request), flashOf(request)));
  });

  server.post('/admin/blocklists/update', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const job = await deps.queue.enqueue(buildJob.updateBlocklists());
    return redirectOnceApplied(reply, deps.awaitJob, job, '/admin/blocklists', 'Blocklists updated.');
  });

  // one form per row, so a tick and a Save move exactly the list you are
  // looking at. An unticked checkbox sends nothing, which is the off case.
  const blocklistToggleSchema = z.object({
    source: z.enum(['iblocklist', 'personal']),
    author: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    enabled: z.literal('on').optional(),
  });

  server.post('/admin/blocklists/enabled', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = blocklistToggleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    const enabled = parsed.data.enabled === 'on';
    const job = await deps.queue.enqueue(
      buildJob.setBlocklistEnabled({
        source: parsed.data.source,
        author: parsed.data.author,
        name: parsed.data.name,
        enabled,
      }),
    );
    return redirectOnceApplied(reply, deps.awaitJob, job,
      '/admin/blocklists',
      viewerOf(session, request).t(
        enabled
          ? '{name} is back in the filter, which has been rebuilt.'
          : '{name} is out of the filter, which has been rebuilt.',
        { name: parsed.data.name },
      ),
    );
  });

  server.post('/admin/blocklists/import-catalog', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const job = await deps.queue.enqueue(buildJob.importBlocklistCatalog());
    return redirectOnceApplied(reply, deps.awaitJob, job, '/admin/blocklists', 'Catalog imported.');
  });
}
