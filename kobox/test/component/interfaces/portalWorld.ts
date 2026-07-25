import type { FastifyInstance } from 'fastify';
import type { Job } from '../../../src/application/jobs/contract.js';
import type { ClaimedJob, JobQueuePort } from '../../../src/application/jobs/JobQueuePort.js';
import { Authenticate } from '../../../src/application/portal/Authenticate.js';
import { Login } from '../../../src/application/portal/Login.js';
import { Logout } from '../../../src/application/portal/Logout.js';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import type { Password } from '../../../src/domain/user/Password.js';
import { Username } from '../../../src/domain/user/Username.js';
import type { VpnProfileStorePort } from '../../../src/application/portal/ports.js';
import type { HealthCheckResult, HealthProbePort, PasswordHasherPort } from '../../../src/domain/user/ports.js';
import { InMemoryBlocklistRepository } from '../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { InMemoryFairUseRepository } from '../../../src/infrastructure/persistence/InMemoryFairUseRepository.js';
import { InMemoryComponentRegistry } from '../../../src/infrastructure/persistence/InMemoryComponentRegistry.js';
import { InMemoryLoginAttemptsRepository } from '../../../src/infrastructure/persistence/InMemoryLoginAttemptsRepository.js';
import { InMemoryMailOutbox } from '../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryReleaseRepository } from '../../../src/infrastructure/persistence/InMemoryReleaseRepository.js';
import { InMemoryTrackerRepository } from '../../../src/infrastructure/persistence/InMemoryTrackerRepository.js';
import { InMemoryUserAddressRepository } from '../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { InMemoryPortalCredentialsRepository } from '../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryPortalSessionRepository } from '../../../src/infrastructure/persistence/InMemoryPortalSessionRepository.js';
import { InMemoryUserRepository } from '../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeSessionTokens } from '../../../src/infrastructure/system/fakes/FakeSessionTokens.js';
import {
  buildPortalServer,
  type PortalServerDeps,
} from '../../../src/interfaces/http/server.js';
import { UserBuilder } from '../../builders/UserBuilder.js';

export const NOW = '2026-07-25 10:00:00';

// A stub probe: everything healthy unless a test swaps in its own.
class AllHealthyProbe implements HealthProbePort {
  checkProcess(processName: string): Promise<HealthCheckResult> {
    return Promise.resolve({ name: processName, state: 'healthy' });
  }

  checkSocket(host: string, port: number): Promise<HealthCheckResult> {
    return Promise.resolve({ name: `${host}:${port}`, state: 'healthy' });
  }
}
// A profile store that has no files unless a test swaps its own in.
class NoProfiles implements VpnProfileStorePort {
  read(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}

// FakeHasher output for the 8-character test password
const GOOD_HASH = HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}8`);
export const TEST_PASSWORD = '8chars!!';

export class FakeHasher implements PasswordHasherPort {
  hash(password: Password): Promise<HashedPassword> {
    return Promise.resolve(
      HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}${String(password.reveal().length)}`),
    );
  }

  async verify(password: Password, hash: HashedPassword): Promise<boolean> {
    return (await this.hash(password)).value === hash.value;
  }
}

// Records enqueued jobs; the portal never consumes them, so claiming is out.
export class RecordingQueue implements JobQueuePort {
  readonly jobs: Job[] = [];

  enqueue(job: Job): Promise<number> {
    this.jobs.push(job);
    return Promise.resolve(this.jobs.length);
  }

  enqueueUnique(job: Job): Promise<number | undefined> {
    return this.enqueue(job);
  }

  claimNextPending(): Promise<ClaimedJob | undefined> {
    return Promise.reject(new Error('the portal must never consume jobs'));
  }

  markDone(): Promise<void> {
    return Promise.reject(new Error('the portal must never consume jobs'));
  }

  markFailed(): Promise<void> {
    return Promise.reject(new Error('the portal must never consume jobs'));
  }

  recoverStale(): Promise<number> {
    return Promise.reject(new Error('the portal must never consume jobs'));
  }
}

export interface PortalWorld {
  readonly server: FastifyInstance;
  readonly users: InMemoryUserRepository;
  readonly credentials: InMemoryPortalCredentialsRepository;
  readonly sessions: InMemoryPortalSessionRepository;
  readonly queue: RecordingQueue;
  readonly outbox: InMemoryMailOutbox;
}

// Builds a portal server over in-memory fakes with two accounts:
// alice (role user) and boss (role admin), both using TEST_PASSWORD.
export async function buildPortalWorld(
  extra?: Partial<PortalServerDeps>,
): Promise<PortalWorld> {
  const users = new InMemoryUserRepository();
  const credentials = new InMemoryPortalCredentialsRepository();
  const sessions = new InMemoryPortalSessionRepository();
  const attempts = new InMemoryLoginAttemptsRepository();
  const tokens = new FakeSessionTokens();
  const hasher = new FakeHasher();
  const queue = new RecordingQueue();
  const outbox = new InMemoryMailOutbox();
  const authDeps = { users, credentials, sessions, attempts, tokens, hasher };
  const server = buildPortalServer({
    login: new Login(authDeps),
    logout: new Logout(authDeps),
    authenticate: new Authenticate(authDeps),
    now: () => NOW,
    users,
    queue,
    hasher,
    trackers: new InMemoryTrackerRepository(),
    blocklists: new InMemoryBlocklistRepository(),
    addresses: new InMemoryUserAddressRepository(),
    bindings: new InMemoryUserAddressRepository(),
    fairUse: new InMemoryFairUseRepository(),
    health: new AllHealthyProbe(),
    components: new InMemoryComponentRegistry(),
    releases: new InMemoryReleaseRepository(),
    outbox,
    credentials,
    profiles: new NoProfiles(),
    ...extra,
  });
  await users.save(new UserBuilder().build());
  await credentials.save(
    { username: Username.parse('alice'), passwordHash: GOOD_HASH, role: 'user' },
    NOW,
  );
  await users.save(
    new UserBuilder()
      .withUsername('boss')
      .withEmail('boss@example.org')
      .withScgiPort(51102)
      .withRtorrentPort(45001)
      .build(),
  );
  await credentials.save(
    { username: Username.parse('boss'), passwordHash: GOOD_HASH, role: 'admin' },
    NOW,
  );
  return { server, users, credentials, sessions, queue, outbox };
}

export interface AgentSession {
  readonly cookie: string;
  readonly csrf: string;
}

export async function loginAs(world: PortalWorld, username: string): Promise<AgentSession> {
  const response = await world.server.inject({
    method: 'POST',
    url: '/login',
    payload: `username=${username}&password=${TEST_PASSWORD}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const setCookie = response.headers['set-cookie'];
  const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = (rawCookie ?? '').split(';')[0] ?? '';
  const home = await world.server.inject({ method: 'GET', url: '/', headers: { cookie } });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(home.body)?.[1] ?? '';
  return { cookie, csrf };
}

export function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}
