import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RequestDebridDownload } from '../../../application/ddl/RequestDebridDownload.js';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import type { VpnProfileStorePort } from '../../../application/portal/ports.js';
import { DownloadCategory } from '../../../domain/ddl/DownloadCategory.js';
import { FilehosterLink } from '../../../domain/ddl/FilehosterLink.js';
import type { DebridDownloadRepository } from '../../../domain/ddl/ports.js';
import type { PortalCredentialsPort } from '../../../domain/portal/ports.js';
import { DomainError } from '../../../domain/shared/DomainError.js';
import type { FairUseRepository } from '../../../domain/security/ports.js';
import { VPN_VARIANTS, type VpnVariant } from '../../../domain/security/vpn.js';
import { Password } from '../../../domain/user/Password.js';
import type { PasswordHasherPort, UserRepository } from '../../../domain/user/ports.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import {
  accessPage,
  adminHomePage,
  downloadsPage,
  passwordPage,
  rutorrentPage,
  userHomePage,
  type FleetRow,
} from '../views/userPages.js';

const passwordSchema = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(8).max(256),
});

const downloadSchema = z.object({
  link: z.string().min(1).max(2048),
  category: z.enum(['films', 'series']),
});

function isVpnVariant(raw: string): raw is VpnVariant {
  return (VPN_VARIANTS as readonly string[]).includes(raw);
}

// A malformed link is a form error, not a 500: parse it here and let the caller
// re-render the page. Only a domain rejection is swallowed — anything else throws.
function parseLink(raw: string | undefined): FilehosterLink | undefined {
  if (raw === undefined) {
    return undefined;
  }
  try {
    return FilehosterLink.parse(raw);
  } catch (error) {
    if (error instanceof DomainError) {
      return undefined;
    }
    throw error;
  }
}

export interface UserRoutesDeps {
  readonly users: UserRepository;
  readonly fairUse: FairUseRepository;
  readonly queue: JobQueuePort;
  readonly hasher: PasswordHasherPort;
  readonly credentials: PortalCredentialsPort;
  readonly profiles: VpnProfileStorePort;
  readonly downloads: DebridDownloadRepository;
  readonly requestDownload: RequestDebridDownload;
}

export function registerUserRoutes(
  server: FastifyInstance,
  deps: UserRoutesDeps,
  guards: Guards,
): void {
  // Role-routed home: fleet overview for admins, personal workstation for users.
  server.get('/', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    if (session.role === 'admin') {
      const rows: FleetRow[] = [];
      for (const user of await deps.users.listAll()) {
        const state = await deps.fairUse.getState(user.username);
        rows.push({
          username: user.username.value,
          status: user.status.isSuspended() ? 'suspended' : 'active',
          level: state.level,
        });
      }
      return reply
        .type('text/html')
        .send(adminHomePage(rows, viewerOf(session), flashOf(request)));
    }
    const user = await deps.users.findByUsername(session.username);
    if (user === undefined) {
      return reply.code(303).header('location', '/login').send();
    }
    const state = await deps.fairUse.getState(session.username);
    return reply
      .type('text/html')
      .send(userHomePage(user, state, viewerOf(session), flashOf(request)));
  });

  server.get('/password', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    return reply.type('text/html').send(passwordPage(viewerOf(session)));
  });

  server.post('/password', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(200)
        .type('text/html')
        .send(passwordPage(viewerOf(session), 'Please choose a new password of at least 8 characters.'));
    }
    const stored = await deps.credentials.find(session.username);
    // a valid password is always >= 8 chars, so a shorter `current` is simply
    // incorrect — never let Password.parse throw into an unhandled 500
    const currentValid =
      parsed.data.current.length >= 8 &&
      stored !== undefined &&
      (await deps.hasher.verify(Password.parse(parsed.data.current), stored.passwordHash));
    if (!currentValid) {
      return reply
        .code(200)
        .type('text/html')
        .send(passwordPage(viewerOf(session), 'Your current password is incorrect.'));
    }
    const job = await buildJob.changePassword(
      { username: session.username.value },
      Password.parse(parsed.data.next),
      deps.hasher,
    );
    await deps.queue.enqueue(job);
    return redirectWithFlash(reply, '/password', 'password change queued');
  });

  server.get('/downloads', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    const rows = await deps.downloads.listForUser(session.username);
    return reply
      .type('text/html')
      .send(downloadsPage(viewerOf(session), rows, flashOf(request)));
  });

  server.post('/downloads', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = downloadSchema.safeParse(request.body);
    const link = parseLink(parsed.success ? parsed.data.link : undefined);
    if (!parsed.success || link === undefined) {
      const rows = await deps.downloads.listForUser(session.username);
      return reply
        .code(200)
        .type('text/html')
        .send(
          downloadsPage(
            viewerOf(session),
            rows,
            undefined,
            'Please provide a valid http(s) link and a category.',
          ),
        );
    }
    await deps.requestDownload.execute({
      username: session.username,
      category: DownloadCategory.parse(parsed.data.category),
      link,
    });
    return redirectWithFlash(reply, '/downloads', 'download queued');
  });

  server.get('/access', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    return reply.type('text/html').send(accessPage(viewerOf(session)));
  });

  server.get('/access/ovpn/:variant', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    const variant = (request.params as { variant?: string }).variant ?? '';
    if (!isVpnVariant(variant)) {
      return reply.code(404).send();
    }
    const content = await deps.profiles.read(session.username, variant);
    if (content === undefined) {
      return reply.code(404).send();
    }
    return reply
      .type('application/x-openvpn-profile')
      .header('content-disposition', `attachment; filename="kobox-${variant}.ovpn"`)
      .send(content);
  });

  server.get('/rutorrent', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    return reply.type('text/html').send(rutorrentPage(viewerOf(session)));
  });
}
