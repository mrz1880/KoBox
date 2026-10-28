import type { FastifyReply, FastifyRequest } from 'fastify';
import { passwordField } from './passwordField.js';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RequestDebridDownload } from '../../application/ddl/RequestDebridDownload.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import type { Role } from '../../domain/portal/Role.js';
import type { AuthenticateApp } from '../../application/portal/AuthenticateApp.js';
import type { IssueAppToken } from '../../application/portal/IssueAppToken.js';
import type { Authenticate } from '../../application/portal/Authenticate.js';
import type { EnterTwoStepCode } from '../../application/portal/EnterTwoStepCode.js';
import type { TwoStepSetup } from '../../application/portal/TwoStepSetup.js';
import type { Login } from '../../application/portal/Login.js';
import type { Logout } from '../../application/portal/Logout.js';
import { USERNAME_PATTERN, Username } from '../../domain/user/Username.js';
import type { MailOutboxPort } from '../../application/maintenance/MailOutboxPort.js';
import type { ReleaseRepositoryPort } from '../../application/maintenance/ReleaseRepositoryPort.js';
import type { VpnProfileStorePort } from '../../application/portal/ports.js';
import type { PortalCredentialsPort } from '../../domain/portal/ports.js';
import type { ComponentRegistry } from '../../domain/installation/ports.js';
import type { SpeedtestRepositoryPort } from '../../application/maintenance/SpeedtestPort.js';
import type { MediaRepository } from '../../domain/media/ports.js';
import type {
  DebridAccountRepository,
  DebridDownloadRepository,
  DebridKeyEncryptorPort,
} from '../../domain/ddl/ports.js';
import type { DynDnsBindingRepository, FairUseRepository } from '../../domain/security/ports.js';
import type {
  BlocklistRepository,
  TrackerRepository,
  UserAddressRepository,
} from '../../domain/tracker/ports.js';
import type {
  HealthProbePort,
  PasswordHasherPort,
  PasswordSealerPort,
  UserRepository,
} from '../../domain/user/ports.js';
import type { Logger } from '../../infrastructure/logging/logger.js';
import { buildGuards, SESSION_COOKIE } from './guards.js';
import type { DiagnosticsRepositoryPort } from '../../application/maintenance/DiagnosticsPort.js';
import type { ConfigFileReaderPort } from '../../application/installation/ConfigFileReaderPort.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type {
  MailRelayRepository,
  SaveMailRelay,
} from '../../application/maintenance/ConfigureMailRelay.js';
import type { SiteSettingsRepository } from '../../domain/installation/ports.js';
import type { DiskUsageRepository, SshKeyRepository } from '../../domain/user/ports.js';
import type { SyncDestinationRepository, SyncTransferRepository } from '../../domain/sync/ports.js';
import type { SetSyncDestination } from '../../application/sync/SetSyncDestination.js';
import { registerAdminNetworkRoutes } from './routes/adminNetwork.js';
import { registerAdminOpsRoutes } from './routes/adminOps.js';
import { registerAdminTrackerRoutes } from './routes/adminTrackers.js';
import { registerAdminDomainRoutes } from './routes/adminDomain.js';
import { registerAdminGroupRoutes } from './routes/adminGroups.js';
import { registerAdminMailRoutes } from './routes/adminMail.js';
import { registerAdminUserRoutes } from './routes/adminUsers.js';
import { registerPasswordLinkRoutes } from './routes/passwordLinks.js';
import type {
  InviteMember,
  RequestPasswordReset,
  SendPasswordLink,
  SetPasswordFromLink,
} from '../../application/portal/PasswordLinks.js';
import { registerUserRoutes } from './routes/user.js';
import { loginPage, twoStepCodePage } from './views/loginPage.js';

// The realm a program is asked to authenticate to with its member's token.
const APP_AUTH_CHALLENGE = 'Basic realm="KoBox"';

export { SESSION_COOKIE } from './guards.js';

export interface PortalServerDeps {
  readonly login: Login;
  readonly logout: Logout;
  readonly authenticate: Authenticate;
  readonly enterTwoStepCode: EnterTwoStepCode;
  readonly twoStepSetup: TwoStepSetup;
  // wall-clock milliseconds, for the 30-second steps of two-step codes
  readonly nowMs: () => number;
  readonly authenticateApp: AuthenticateApp;
  readonly issueAppToken: IssueAppToken;
  readonly now: () => string;
  readonly users: UserRepository;
  readonly queue: JobQueuePort;
  readonly hasher: PasswordHasherPort;
  // the public half of the host key: the portal seals a new password for the
  // worker and can never open one back
  readonly passwords: PasswordSealerPort;
  // invitations and forgotten passwords: links to choose a password
  readonly inviteMember: InviteMember;
  readonly sendPasswordLink: SendPasswordLink;
  readonly requestPasswordReset: RequestPasswordReset;
  readonly setPasswordFromLink: SetPasswordFromLink;
  readonly trackers: TrackerRepository;
  readonly blocklists: BlocklistRepository;
  readonly addresses: UserAddressRepository;
  readonly bindings: DynDnsBindingRepository;
  readonly fairUse: FairUseRepository;
  readonly health: HealthProbePort;
  readonly components: ComponentRegistry;
  readonly speedtests: SpeedtestRepositoryPort;
  readonly diagnostics: DiagnosticsRepositoryPort;
  readonly configFiles: ConfigFileReaderPort;
  readonly releases: ReleaseRepositoryPort;
  readonly outbox: MailOutboxPort;
  readonly credentials: PortalCredentialsPort;
  readonly profiles: VpnProfileStorePort;
  readonly downloads: DebridDownloadRepository;
  readonly requestDownload: RequestDebridDownload;
  readonly debridAccounts: DebridAccountRepository;
  readonly debridEncryptor: DebridKeyEncryptorPort;
  readonly media: MediaRepository;
  readonly instances: TorrentInstanceRepository;
  readonly diskSamples: DiskUsageRepository;
  readonly mailRelay: MailRelayRepository;
  readonly boxInVpn: string;
  readonly sshPort: number;
  readonly nextcloudSignsInFromPortal: boolean;
  readonly siteSettings: SiteSettingsRepository;
  readonly saveMailRelay: SaveMailRelay;
  readonly sshKeys: SshKeyRepository;
  readonly destinations: SyncDestinationRepository;
  readonly setDestination: SetSyncDestination;
  readonly transfers: SyncTransferRepository;
  readonly logger?: Logger;
}

// Zod owns the HTTP boundary: whatever fails to parse is an authentication
// failure, never an exception reaching a handler (anti-§5.5).
// a password the domain refuses cannot be anyone's, so it reads as invalid
const loginFormSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN),
  password: passwordField,
});

const HTML_CONTENT_TYPE = 'text/html';
const LANGUAGE_HEADER = 'Accept-Language';

export function buildPortalServer(deps: PortalServerDeps): FastifyInstance {
  const server = Fastify({ logger: false, trustProxy: '127.0.0.1' });
  void server.register(fastifyCookie);
  void server.register(fastifyFormbody);

  // A page's language follows Accept-Language for a member who never chose
  // (and on every page before sign-in): a cache must key on it.
  server.addHook('onSend', async (_request, reply, payload) => {
    const type = reply.getHeader('content-type');
    if (typeof type === 'string' && type.startsWith(HTML_CONTENT_TYPE)) {
      reply.header('vary', LANGUAGE_HEADER);
    }
    return payload;
  });

  const guards = buildGuards(deps.authenticate, deps.now);
  const twoStepCodeSchema = z.object({ code: z.string().regex(/^[0-9]{6}$/) });

  server.get('/login', async (request, reply) => {
    if ((await guards.sessionOf(request)) !== undefined) {
      return reply.code(303).header('location', '/').send();
    }
    return reply.type('text/html').send(loginPage());
  });

  server.post('/login', async (request, reply) => {
    const parsed = loginFormSchema.safeParse(request.body);
    if (!parsed.success) {
      deps.logger?.warn(`portal login failed for <malformed> from ${request.ip}`);
      return reply.type('text/html').send(loginPage('Invalid credentials.'));
    }
    const result = await deps.login.execute({
      username: Username.parse(parsed.data.username),
      password: parsed.data.password,
      now: deps.now(),
    });
    if (!result.ok) {
      deps.logger?.warn(
        `portal login failed for ${parsed.data.username} from ${request.ip} (${result.reason})`,
      );
      const message =
        result.reason === 'locked'
          ? 'Too many attempts — account temporarily locked.'
          : result.reason === 'suspended'
            ? 'This account is suspended.'
            : 'Invalid credentials.';
      return reply.type('text/html').send(loginPage(message));
    }
    return reply
      .setCookie(SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      })
      .code(303)
      .header('location', result.awaitingCode ? '/login/code' : '/')
      .send();
  });

  server.get('/login/code', async (request, reply) => {
    if ((await guards.pendingSessionOf(request)) === undefined) {
      return reply.code(303).header('location', '/login').send();
    }
    return reply.type('text/html').send(twoStepCodePage());
  });

  server.post('/login/code', async (request, reply) => {
    const parsed = twoStepCodeSchema.safeParse(request.body);
    const token = request.cookies[SESSION_COOKIE] ?? '';
    const outcome = parsed.success
      ? await deps.enterTwoStepCode.execute({
          token,
          code: parsed.data.code,
          now: deps.now(),
          nowMs: deps.nowMs(),
        })
      : 'wrong-code';
    switch (outcome) {
      case 'accepted':
        return reply.code(303).header('location', '/').send();
      case 'no-session':
        return reply.code(303).header('location', '/login').send();
      case 'locked':
        deps.logger?.warn(`portal two-step code refused from ${request.ip} (locked)`);
        return reply.type('text/html').send(twoStepCodePage('Too many attempts: account temporarily locked.'));
      case 'wrong-code':
        // same line as a wrong password: fail2ban counts both
        deps.logger?.warn(`portal login failed for <two-step> from ${request.ip} (wrong-code)`);
        return reply.type('text/html').send(twoStepCodePage('That code did not work. Try the current one.'));
    }
  });

  // leaving the code page: the half-open session is dropped
  server.post('/logout/pending', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined) {
      await deps.logout.execute({ token });
    }
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).code(303).header('location', '/login').send();
  });

  server.post('/logout', async (request, reply) => {
    const session = await guards.requireCsrf(request, reply);
    if (session === undefined) {
      return;
    }
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined) {
      await deps.logout.execute({ token });
    }
    return reply
      .clearCookie(SESSION_COOKIE, { path: '/' })
      .code(303)
      .header('location', '/login')
      .send();
  });

  server.get('/healthz', async (_request, reply) => reply.code(200).send({ status: 'ok' }));

  // nginx auth_request subrequests: bare status codes, no redirects. The
  // authenticated username travels back on a header for REMOTE_USER wiring.
  // A machine has no cookie: Radarr and Sonarr drive rTorrent through
  // ruTorrent's httprpc endpoint with HTTP Basic. Their credential is the
  // member's app token, never the account password — so a leaked download-client
  // config costs the token and not the portal account.
  const appOf = async (
    request: FastifyRequest,
  ): Promise<{ username: Username; role: Role } | undefined> => {
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Basic ')) {
      return undefined;
    }
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) {
      return undefined;
    }
    return deps.authenticateApp.execute({
      username: decoded.slice(0, separator),
      token: decoded.slice(separator + 1),
    });
  };

  // Where a program may present a token instead of a session, a refusal names
  // the scheme: .NET clients (Sonarr, Radarr) only send their credentials once
  // challenged. nginx's auth_request copies a 401 subrequest's challenge onto
  // the response itself, so this header is the only one the client sees.
  const challenge = (reply: FastifyReply): FastifyReply =>
    reply.header('www-authenticate', APP_AUTH_CHALLENGE).code(401).send();

  server.get('/internal/auth', async (request, reply) => {
    const app = await appOf(request);
    if (app !== undefined) {
      return reply.header('x-kobox-user', app.username.value).code(204).send();
    }
    const session = await guards.sessionOf(request);
    if (session === undefined) {
      return challenge(reply);
    }
    if (session.mustChangePassword) {
      return reply.code(403).send();
    }
    return reply.header('x-kobox-user', session.username.value).code(204).send();
  });

  // ONE ownership rule, whether the caller arrived with a cookie or a token: a
  // second copy of an authorisation check is a second copy to get wrong.
  const rpcVerdict = (
    reply: FastifyReply,
    request: FastifyRequest,
    username: string,
    role: Role,
  ): FastifyReply => {
    const original = String(request.headers['x-original-uri'] ?? '');
    const match = /^\/RPC-([A-Za-z0-9]+)(?:[/?].*)?$/.exec(original);
    const owner = match?.[1]?.toLowerCase();
    if (owner === undefined) {
      return reply.code(403).send();
    }
    if (role !== 'admin' && username !== owner) {
      return reply.code(403).send();
    }
    return reply.header('x-kobox-user', username).code(204).send();
  };

  server.get('/internal/auth/rpc', async (request, reply) => {
    const app = await appOf(request);
    if (app !== undefined) {
      return rpcVerdict(reply, request, app.username.value, app.role);
    }
    const session = await guards.sessionOf(request);
    if (session === undefined) {
      return challenge(reply);
    }
    // ruTorrent/RPC stays closed until the forced password change is done
    if (session.mustChangePassword) {
      return reply.code(403).send();
    }
    return rpcVerdict(reply, request, session.username.value, session.role);
  });

  server.get('/internal/auth/admin', async (request, reply) => {
    const session = await guards.sessionOf(request);
    if (session === undefined) {
      return reply.code(401).send();
    }
    if (session.mustChangePassword) {
      return reply.code(403).send();
    }
    if (session.role !== 'admin') {
      return reply.code(403).send();
    }
    return reply.header('x-kobox-user', session.username.value).code(204).send();
  });

  // Who is signed in to the portal, for Nextcloud: nginx asks before every
  // Nextcloud request and hands the name to Nextcloud, which opens that member's
  // session. Never a refusal, since Nextcloud's own sign-in page and its apps go
  // through here too; and the cookie only, never a client's credentials, which
  // for Nextcloud's apps are Nextcloud's own and prove nothing here.
  server.get('/internal/auth/session', async (request, reply) => {
    const session = await guards.sessionOf(request);
    if (session === undefined || session.mustChangePassword) {
      return reply.code(204).send();
    }
    return reply.header('x-kobox-user', session.username.value).code(204).send();
  });

  registerUserRoutes(server, deps, guards);
  registerAdminUserRoutes(server, deps, guards);
  registerPasswordLinkRoutes(server, deps);
  registerAdminMailRoutes(server, deps, guards);
  registerAdminGroupRoutes(server, guards);
  registerAdminDomainRoutes(server, deps, guards);
  registerAdminTrackerRoutes(server, deps, guards);
  registerAdminNetworkRoutes(server, deps, guards);
  registerAdminOpsRoutes(server, deps, guards);

  return server;
}
