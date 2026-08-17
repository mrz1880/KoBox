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
import { Label } from '../../../domain/torrent/Label.js';
import { SyncMode } from '../../../domain/torrent/SyncMode.js';
import type { TorrentInstanceRepository } from '../../../domain/torrent/ports.js';
import type { SyncDestinationRepository, SyncTransferRepository } from '../../../domain/sync/ports.js';
import type { SetSyncDestination } from '../../../application/sync/SetSyncDestination.js';
import { LoneFilePlacement } from '../../../domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../domain/sync/RemoteHost.js';
import { RemotePassword } from '../../../domain/sync/RemotePassword.js';
import { RemotePath } from '../../../domain/sync/RemotePath.js';
import { RemotePort } from '../../../domain/sync/RemotePort.js';
import { SendHour } from '../../../domain/sync/SendHour.js';
import { TransferBatchSize } from '../../../domain/sync/TransferBatchSize.js';
import type { Username } from '../../../domain/user/Username.js';
import type {
  DebridAccountRepository,
  DebridDownloadRepository,
  DebridKeyEncryptorPort,
} from '../../../domain/ddl/ports.js';
import type { PortalCredentialsPort } from '../../../domain/portal/ports.js';
import type { IssueAppToken } from '../../../application/portal/IssueAppToken.js';
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
import { syncPage } from '../views/syncPage.js';

const categorySchema = z.object({ label: z.string().min(1).max(64) });
const retrySchema = z.object({ id: z.coerce.number().int().positive() });
const destinationSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  account: z.string().min(1).max(64),
  // empty means "keep the stored one": a form cannot show a password back
  password: z.string().max(256).optional(),
  path: z.string().min(1).max(512),
  batchSize: z.coerce.number().int().min(0).max(1000),
  placement: z.string().min(1).max(32),
  sendHour: z.coerce.number().int().min(0).max(23),
});
const categoryModeSchema = z.object({
  label: z.string().min(1).max(64),
  mode: z.string().min(1).max(16),
});

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
  readonly issueAppToken: IssueAppToken;
  readonly profiles: VpnProfileStorePort;
  readonly downloads: DebridDownloadRepository;
  readonly requestDownload: RequestDebridDownload;
  readonly debridAccounts: DebridAccountRepository;
  // the portal holds the PUBLIC half only — it can seal a key, never open one
  readonly debridEncryptor: DebridKeyEncryptorPort;
  readonly media: MediaRepository;
  readonly instances: TorrentInstanceRepository;
  readonly destinations: SyncDestinationRepository;
  // seals with the PUBLIC half of the host key; it can never open one back
  readonly setDestination: SetSyncDestination;
  readonly transfers: SyncTransferRepository;
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

  server.get('/sync', async (request, reply) => {
    const session = await guards.requireSession(request, reply);
    if (session === undefined) {
      return;
    }
    const instance = await deps.instances.findByUsername(session.username);
    // the root watch dir is everything without a label: it is not a folder a
    // member named, and it cannot be synchronised
    const categories = (instance?.watchDirs ?? []).filter((dir) => dir.label !== undefined);
    const destination = await deps.destinations.findByUsername(session.username);
    const transfers = await deps.transfers.listRecent(session.username, 25);
    return reply
      .type('text/html')
      .send(syncPage(categories, destination, transfers, viewerOf(session), flashOf(request)));
  });

  server.post('/sync/categories', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = categorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    let label: Label;
    try {
      label = Label.parse(parsed.data.label);
    } catch (error) {
      if (error instanceof DomainError) {
        return reply.code(400).send();
      }
      throw error;
    }
    // the username comes from the session, never from the form: a member can
    // only ever create a folder for themselves
    await deps.queue.enqueue(
      buildJob.addWatchDir({ username: session.username.value, label: label.value }),
    );
    return redirectWithFlash(reply, '/sync', `Creating the ${label.value} folder.`);
  });

  server.post('/sync/categories/mode', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = categoryModeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    let label: Label;
    let mode: SyncMode;
    try {
      label = Label.parse(parsed.data.label);
      mode = SyncMode.parse(parsed.data.mode);
    } catch (error) {
      if (error instanceof DomainError) {
        return reply.code(400).send();
      }
      throw error;
    }
    await deps.queue.enqueue(
      buildJob.setCategorySyncMode({
        username: session.username.value,
        label: label.value,
        mode: mode.value,
      }),
    );
    return redirectWithFlash(reply, '/sync', `Saved what happens to ${label.value}.`);
  });

  server.post('/sync/destination', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = destinationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    const form = parsed.data;
    try {
      // every field becomes a value object before it can reach a command line:
      // a host starting with a dash would be an ssh option, not a host
      await deps.setDestination.execute({
        username: session.username,
        host: RemoteHost.parse(form.host),
        port: RemotePort.parse(form.port),
        account: RemoteAccount.parse(form.account),
        path: RemotePath.parse(form.path),
        batchSize: TransferBatchSize.parse(form.batchSize),
        placement: LoneFilePlacement.parse(form.placement),
        sendHour: SendHour.parse(form.sendHour),
        ...(form.password !== undefined &&
          form.password !== '' && { password: RemotePassword.parse(form.password) }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return redirectWithFlash(reply, '/sync', error.message);
      }
      throw error;
    }
    return redirectWithFlash(reply, '/sync', 'Saved. Test it before you rely on it.');
  });

  server.post('/sync/destination/test', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    // the portal cannot open the sealed password, so it cannot run this itself:
    // it asks the root worker, which holds the private half of the host key
    const id = await deps.queue.enqueueUnique(
      buildJob.checkSyncDestination({ username: session.username.value }),
    );
    return redirectWithFlash(
      reply,
      '/sync',
      id === undefined ? 'A test is already running.' : 'Testing the connection.',
    );
  });

  server.post('/sync/transfers/retry', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const parsed = retrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send();
    }
    // the worker owns the queue; ownership of the row is checked there too,
    // against the username from THIS session rather than from the form
    await deps.queue.enqueue(
      buildJob.requeueTransfer({ username: session.username.value, id: parsed.data.id }),
    );
    return redirectWithFlash(reply, '/sync', 'Putting it back in the queue.');
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
        hasAppToken: (await deps.credentials.find(session.username))?.appTokenHash !== undefined,
        // only shown when the operator configured a reachable name for the box
        ...(sftpHost !== undefined && sftpHost !== '' && { sftpHost }),
        rtorrentPort: user.rtorrentPort.value,
      }),
    );
  });

  server.post('/access/app-token', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const token = await deps.issueAppToken.execute(session.username);
    if (token === undefined) {
      return reply.code(404).send();
    }
    const user = await deps.users.findByUsername(session.username);
    if (user === undefined) {
      return reply.code(404).send();
    }
    const sftpHost = process.env.KOBOX_VPN_REMOTE;
    // rendered straight into THIS response and nowhere else: only its hash is
    // stored, so no redirect could show it afterwards
    return reply.type('text/html').send(
      accessPage(viewerOf(session), {
        username: user.username.value,
        ...(sftpHost !== undefined && sftpHost !== '' && { sftpHost }),
        rtorrentPort: user.rtorrentPort.value,
        hasAppToken: true,
        freshToken: token.reveal(),
      }),
    );
  });

  server.post('/access/app-token/revoke', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    await deps.issueAppToken.revoke(session.username);
    return redirectWithFlash(reply, '/access', 'That token no longer works anywhere.');
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
