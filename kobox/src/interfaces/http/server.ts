import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RequestDebridDownload } from '../../application/ddl/RequestDebridDownload.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import type { Authenticate } from '../../application/portal/Authenticate.js';
import type { Login } from '../../application/portal/Login.js';
import type { Logout } from '../../application/portal/Logout.js';
import { Password } from '../../domain/user/Password.js';
import { USERNAME_PATTERN, Username } from '../../domain/user/Username.js';
import type { MailOutboxPort } from '../../application/maintenance/MailOutboxPort.js';
import type { ReleaseRepositoryPort } from '../../application/maintenance/ReleaseRepositoryPort.js';
import type { VpnProfileStorePort } from '../../application/portal/ports.js';
import type { PortalCredentialsPort } from '../../domain/portal/ports.js';
import type { ComponentRegistry } from '../../domain/installation/ports.js';
import type { SpeedtestRepositoryPort } from '../../application/maintenance/SpeedtestPort.js';
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
import type { HealthProbePort, PasswordHasherPort, UserRepository } from '../../domain/user/ports.js';
import type { Logger } from '../../infrastructure/logging/logger.js';
import { buildGuards, SESSION_COOKIE } from './guards.js';
import { registerAdminNetworkRoutes } from './routes/adminNetwork.js';
import { registerAdminOpsRoutes } from './routes/adminOps.js';
import { registerAdminTrackerRoutes } from './routes/adminTrackers.js';
import { registerAdminUserRoutes } from './routes/adminUsers.js';
import { registerUserRoutes } from './routes/user.js';
import { loginPage } from './views/loginPage.js';

export { SESSION_COOKIE } from './guards.js';

export interface PortalServerDeps {
  readonly login: Login;
  readonly logout: Logout;
  readonly authenticate: Authenticate;
  readonly now: () => string;
  readonly users: UserRepository;
  readonly queue: JobQueuePort;
  readonly hasher: PasswordHasherPort;
  readonly trackers: TrackerRepository;
  readonly blocklists: BlocklistRepository;
  readonly addresses: UserAddressRepository;
  readonly bindings: DynDnsBindingRepository;
  readonly fairUse: FairUseRepository;
  readonly health: HealthProbePort;
  readonly components: ComponentRegistry;
  readonly speedtests: SpeedtestRepositoryPort;
  readonly releases: ReleaseRepositoryPort;
  readonly outbox: MailOutboxPort;
  readonly credentials: PortalCredentialsPort;
  readonly profiles: VpnProfileStorePort;
  readonly downloads: DebridDownloadRepository;
  readonly requestDownload: RequestDebridDownload;
  readonly debridAccounts: DebridAccountRepository;
  readonly debridEncryptor: DebridKeyEncryptorPort;
  readonly logger?: Logger;
}

// Zod owns the HTTP boundary: whatever fails to parse is an authentication
// failure, never an exception reaching a handler (anti-§5.5).
const loginFormSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN),
  password: z.string().min(8).max(256),
});

export function buildPortalServer(deps: PortalServerDeps): FastifyInstance {
  const server = Fastify({ logger: false, trustProxy: '127.0.0.1' });
  void server.register(fastifyCookie);
  void server.register(fastifyFormbody);

  const guards = buildGuards(deps.authenticate, deps.now);

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
      password: Password.parse(parsed.data.password),
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
      .header('location', '/')
      .send();
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
  server.get('/internal/auth', async (request, reply) => {
    const session = await guards.sessionOf(request);
    if (session === undefined) {
      return reply.code(401).send();
    }
    if (session.mustChangePassword) {
      return reply.code(403).send();
    }
    return reply.header('x-kobox-user', session.username.value).code(204).send();
  });

  server.get('/internal/auth/rpc', async (request, reply) => {
    const session = await guards.sessionOf(request);
    if (session === undefined) {
      return reply.code(401).send();
    }
    // ruTorrent/RPC stays closed until the forced password change is done
    if (session.mustChangePassword) {
      return reply.code(403).send();
    }
    const original = String(request.headers['x-original-uri'] ?? '');
    const match = /^\/RPC-([A-Za-z0-9]+)(?:[/?].*)?$/.exec(original);
    const owner = match?.[1]?.toLowerCase();
    if (owner === undefined) {
      return reply.code(403).send();
    }
    if (session.role !== 'admin' && session.username.value !== owner) {
      return reply.code(403).send();
    }
    return reply.header('x-kobox-user', session.username.value).code(204).send();
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

  registerUserRoutes(server, deps, guards);
  registerAdminUserRoutes(server, deps, guards);
  registerAdminTrackerRoutes(server, deps, guards);
  registerAdminNetworkRoutes(server, deps, guards);
  registerAdminOpsRoutes(server, deps, guards);

  return server;
}
