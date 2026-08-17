import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import type { MailRelayRepository } from '../../../application/maintenance/ConfigureMailRelay.js';
import type { MailOutboxPort } from '../../../application/maintenance/MailOutboxPort.js';
import type { RemotePasswordSealerPort } from '../../../domain/sync/ports.js';
import { RemotePassword } from '../../../domain/sync/RemotePassword.js';
import type { UserRepository } from '../../../domain/user/ports.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import { adminMailPage } from '../views/adminMailPage.js';

// The relay host is a name, not a URL: no scheme, no path, no port suffix.
const relaySchema = z.object({
  host: z.string().regex(/^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,253}[a-zA-Z0-9])?$/),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().min(1).max(255),
  password: z.string().min(1).max(256),
});

export interface AdminMailDeps {
  readonly queue: JobQueuePort;
  readonly mailRelay: MailRelayRepository;
  readonly sealer: RemotePasswordSealerPort;
  readonly outbox: MailOutboxPort;
  readonly users: UserRepository;
  readonly now: () => string;
}

export function registerAdminMailRoutes(
  server: FastifyInstance,
  deps: AdminMailDeps,
  guards: Guards,
): void {
  server.get('/admin/mail-relay', async (request, reply) => {
    const session = await guards.requireAdmin(request, reply);
    if (session === undefined) {
      return;
    }
    const settings = await deps.mailRelay.get();
    return reply
      .type('text/html')
      .send(adminMailPage(settings, viewerOf(session), flashOf(request)));
  });

  server.post('/admin/mail-relay', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = relaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .type('text/html')
        .send(
          adminMailPage(
            await deps.mailRelay.get(),
            viewerOf(session),
            undefined,
            'A relay needs a hostname, a port between 1 and 65535, a login and a password.',
          ),
        );
    }
    // sealed here, opened only by the root worker: the portal can lock this
    // box, it can never read back what it locked
    const sealedPassword = await deps.sealer.seal(RemotePassword.parse(parsed.data.password));
    await deps.mailRelay.save({
      host: parsed.data.host,
      port: parsed.data.port,
      user: parsed.data.user,
      sealedPassword,
    });
    // the job carries no secret at all, only "apply what is stored"
    await deps.queue.enqueue(buildJob.applyMailRelay());
    return redirectWithFlash(reply, '/admin/mail-relay', 'Relay saved. Applying it now.');
  });

  server.post('/admin/mail-relay/test', async (request, reply) => {
    const session = await guards.requireAdminCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const admin = await deps.users.findByUsername(session.username);
    if (admin === undefined) {
      return reply.code(400).send();
    }
    await deps.outbox.enqueue(
      {
        recipient: admin.email.value,
        subject: 'KoBox test message',
        body: [
          'This is the test message you asked for from the mail settings page.',
          '',
          'If it reached you, the relay works and KoBox can tell your members',
          'about their accounts, their temporary passwords and their torrents.',
        ].join('\n'),
      },
      deps.now(),
    );
    return redirectWithFlash(
      reply,
      '/admin/mail-relay',
      'Test message queued. It goes out on the next send pass, within five minutes.',
    );
  });
}
