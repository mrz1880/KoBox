import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RequestDebridDownload } from '../../../application/ddl/RequestDebridDownload.js';
import type { JobQueuePort } from '../../../application/jobs/JobQueuePort.js';
import type { VpnProfileStorePort } from '../../../application/portal/ports.js';
import { DownloadCategory } from '../../../domain/ddl/DownloadCategory.js';
import { FilehosterLink } from '../../../domain/ddl/FilehosterLink.js';
import { DebridApiKey } from '../../../domain/ddl/DebridApiKey.js';
import { MediaPath, type MediaFile } from '../../../domain/media/MediaFile.js';
import type { MediaRepository } from '../../../domain/media/ports.js';
import type { Username } from '../../../domain/user/Username.js';
import type {
  DebridAccountRepository,
  DebridDownloadRepository,
  DebridKeyEncryptorPort,
} from '../../../domain/ddl/ports.js';
import type { PortalCredentialsPort } from '../../../domain/portal/ports.js';
import { DomainError } from '../../../domain/shared/DomainError.js';
import type { FairUseRepository } from '../../../domain/security/ports.js';
import { VPN_VARIANTS, type VpnVariant } from '../../../domain/security/vpn.js';
import { Password } from '../../../domain/user/Password.js';
import type { PasswordHasherPort, UserRepository } from '../../../domain/user/ports.js';
import type { SeedboxUser } from '../../../domain/user/SeedboxUser.js';
import { buildJob } from '../../cli/buildJob.js';
import { flashOf, redirectWithFlash, viewerOf, type Guards } from '../guards.js';
import {
  accessPage,
  adminHomePage,
  downloadsPage,
  mediaPage,
  mediaWatchPage,
  passwordPage,
  rutorrentPage,
  userHomePage,
  type FleetRow,
  type SignalRow,
} from '../views/userPages.js';

const passwordSchema = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(8).max(256),
});

const downloadSchema = z.object({
  link: z.string().min(1).max(2048),
  category: z.enum(['films', 'series']),
});

const debridKeySchema = z.object({ apiKey: z.string().min(1).max(256) });

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

// A mistyped key is a form error, not a 500 — same contract as parseLink.
function parseDebridKey(raw: string | undefined): DebridApiKey | undefined {
  if (raw === undefined) {
    return undefined;
  }
  try {
    return DebridApiKey.parse(raw);
  } catch (error) {
    if (error instanceof DomainError) {
      return undefined;
    }
    throw error;
  }
}

// A file is served only when it parses as a relative path AND appears in this
// user's own index. Two independent gates: a crafted path cannot escape, and a
// valid-looking path belonging to someone else is simply not found.
async function ownFile(
  deps: Pick<UserRoutesDeps, 'media'>,
  session: { readonly username: Username },
  request: { readonly query: unknown },
): Promise<MediaFile | undefined> {
  const raw = (request.query as Record<string, unknown>).path;
  if (typeof raw !== 'string') {
    return undefined;
  }
  let path: MediaPath;
  try {
    path = MediaPath.parse(raw);
  } catch (error) {
    if (error instanceof DomainError) {
      return undefined;
    }
    throw error;
  }
  return deps.media.find(session.username, path);
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
  readonly debridAccounts: DebridAccountRepository;
  // the portal holds the PUBLIC half only — it can seal a key, never open one
  readonly debridEncryptor: DebridKeyEncryptorPort;
  readonly media: MediaRepository;
}

// One channel of the console, assembled from what the portal can read in the
// database alone: the fair-use verdict and the last usage sample.
async function signalRowFor(
  deps: Pick<UserRoutesDeps, 'fairUse'>,
  user: SeedboxUser,
): Promise<SignalRow> {
  const state = await deps.fairUse.getState(user.username);
  const sample = await deps.fairUse.lastSample(user.username);
  return {
    username: user.username.value,
    suspended: user.status.isSuspended(),
    healthy: state.healthState === 'healthy',
    level: state.level,
    egressBytes: sample?.egressBytes ?? 0,
    quotaGib: user.quota.toGib(),
  };
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
        rows.push(await signalRowFor(deps, user));
      }
      return reply
        .type('text/html')
        .send(adminHomePage(rows, viewerOf(session), flashOf(request)));
    }
    const user = await deps.users.findByUsername(session.username);
    if (user === undefined) {
      return reply.code(303).header('location', '/login').send();
    }
    return reply
      .type('text/html')
      .send(
        userHomePage(user, viewerOf(session), await signalRowFor(deps, user), flashOf(request)),
      );
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
    return redirectWithFlash(reply, '/password', 'Password change under way — it takes a few seconds.');
  });

  server.get('/downloads', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    const rows = await deps.downloads.listForUser(session.username);
    const hasKey = await deps.debridAccounts.has(session.username);
    return reply
      .type('text/html')
      .send(downloadsPage(viewerOf(session), rows, hasKey, flashOf(request)));
  });

  server.post('/downloads/debrid-key', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = debridKeySchema.safeParse(request.body);
    const key = parseDebridKey(parsed.success ? parsed.data.apiKey : undefined);
    if (key === undefined) {
      const rows = await deps.downloads.listForUser(session.username);
      const hasKey = await deps.debridAccounts.has(session.username);
      return reply
        .code(200)
        .type('text/html')
        .send(
          downloadsPage(
            viewerOf(session),
            rows,
            hasKey,
            undefined,
            "That doesn't look like an AllDebrid API key.",
          ),
        );
    }
    // sealed HERE with the public half: the plaintext key never reaches the job
    // payload, the database, or a log line
    const encryptedKey = await deps.debridEncryptor.encrypt(key);
    await deps.queue.enqueue(
      buildJob.setDebridKey({ username: session.username.value, encryptedKey }),
    );
    return redirectWithFlash(reply, '/downloads', 'Key saved.');
  });

  server.post('/downloads/debrid-key/clear', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    await deps.queue.enqueue(buildJob.clearDebridKey({ username: session.username.value }));
    return redirectWithFlash(reply, '/downloads', 'Key removed.');
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
      const hasKey = await deps.debridAccounts.has(session.username);
      return reply
        .code(200)
        .type('text/html')
        .send(
          downloadsPage(
            viewerOf(session),
            rows,
            hasKey,
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
    return redirectWithFlash(reply, '/downloads', 'Download started. It will appear in the list below.');
  });

  server.post('/rutorrent/restart', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    // the username comes from the session, never the body: a user can only
    // restart their own instance
    await deps.queue.enqueue(buildJob.restartRtorrent({ username: session.username.value }));
    return redirectWithFlash(reply, '/rutorrent', 'Restarting your rtorrent.');
  });

  server.get('/media', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    const files = await deps.media.listFor(session.username);
    return reply.type('text/html').send(mediaPage(viewerOf(session), files, flashOf(request)));
  });

  server.get('/media/watch', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    const file = await ownFile(deps, session, request);
    if (file === undefined) {
      return reply.code(404).send();
    }
    return reply.type('text/html').send(mediaWatchPage(viewerOf(session), file));
  });

  // The bytes themselves. The portal only AUTHORISES: it hands nginx an internal
  // path and nginx streams the file, which is what makes seeking work (range
  // requests) and keeps this process without any disk access of its own.
  server.get('/media/file', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    const file = await ownFile(deps, session, request);
    if (file === undefined) {
      return reply.code(404).send();
    }
    return reply
      .header('x-accel-redirect', `/internal-media/${session.username.value}/${file.path.value}`)
      .header('content-disposition', `inline; filename="${file.path.name}"`)
      .code(200)
      .send();
  });

  server.get('/access', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    const user = await deps.users.findByUsername(session.username);
    if (user === undefined) {
      return reply.code(303).header('location', '/login').send();
    }
    const sftpHost = process.env.KOBOX_VPN_REMOTE;
    return reply.type('text/html').send(
      accessPage(viewerOf(session), {
        username: user.username.value,
        // only shown when the operator configured a reachable name for the box
        ...(sftpHost !== undefined && sftpHost !== '' && { sftpHost }),
        rtorrentPort: user.rtorrentPort.value,
      }),
    );
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
    return reply.type('text/html').send(rutorrentPage(viewerOf(session), flashOf(request)));
  });
}
