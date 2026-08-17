import type { FastifyInstance } from 'fastify';
import { RequestDebridDownload } from '../../../src/application/ddl/RequestDebridDownload.js';
import type { Job } from '../../../src/application/jobs/contract.js';
import type { ClaimedJob, JobQueuePort } from '../../../src/application/jobs/JobQueuePort.js';
import { Authenticate } from '../../../src/application/portal/Authenticate.js';
import { AuthenticateApp } from '../../../src/application/portal/AuthenticateApp.js';
import { IssueAppToken } from '../../../src/application/portal/IssueAppToken.js';
import { Login } from '../../../src/application/portal/Login.js';
import { Logout } from '../../../src/application/portal/Logout.js';
import type { DebridApiKey } from '../../../src/domain/ddl/DebridApiKey.js';
import type { DebridKeyEncryptorPort } from '../../../src/domain/ddl/ports.js';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import type { Password } from '../../../src/domain/user/Password.js';
import { Username } from '../../../src/domain/user/Username.js';
import { RtorrentPort, ScgiPort } from '../../../src/domain/user/Port.js';
import { Label } from '../../../src/domain/torrent/Label.js';
import { TorrentInstance } from '../../../src/domain/torrent/TorrentInstance.js';
import type { VpnProfileStorePort } from '../../../src/application/portal/ports.js';
import type {
  ConfigFileContent,
  ConfigFileReaderPort,
} from '../../../src/application/installation/ConfigFileReaderPort.js';
import type { ConfigDocument } from '../../../src/domain/installation/ConfigDocument.js';
import type { RemotePasswordSealerPort } from '../../../src/domain/sync/ports.js';
import type { RemotePassword } from '../../../src/domain/sync/RemotePassword.js';
import { SetSyncDestination } from '../../../src/application/sync/SetSyncDestination.js';
import type { HealthCheckResult, HealthProbePort, PasswordHasherPort } from '../../../src/domain/user/ports.js';
import { InMemoryBlocklistRepository } from '../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { InMemoryFairUseRepository } from '../../../src/infrastructure/persistence/InMemoryFairUseRepository.js';
import { InMemoryComponentRegistry } from '../../../src/infrastructure/persistence/InMemoryComponentRegistry.js';
import { InMemorySyncTransferRepository } from '../../../src/infrastructure/persistence/InMemorySyncTransferRepository.js';
import { InMemorySyncDestinationRepository } from '../../../src/infrastructure/persistence/InMemorySyncDestinationRepository.js';
import { InMemorySiteSettingsRepository } from '../../../src/infrastructure/persistence/InMemorySiteSettingsRepository.js';
import { InMemoryMailRelayRepository } from '../../../src/infrastructure/persistence/InMemoryMailRelayRepository.js';
import { InMemorySshKeyRepository } from '../../../src/infrastructure/persistence/InMemorySshKeyRepository.js';
import { InMemoryDiskUsageRepository } from '../../../src/infrastructure/persistence/InMemoryDiskUsageRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryDiagnosticsRepository } from '../../../src/infrastructure/persistence/InMemoryDiagnosticsRepository.js';
import { InMemorySpeedtestRepository } from '../../../src/infrastructure/persistence/InMemorySpeedtestRepository.js';
import { InMemoryMediaRepository } from '../../../src/infrastructure/persistence/InMemoryMediaRepository.js';
import { InMemoryDebridAccountRepository } from '../../../src/infrastructure/persistence/InMemoryDebridAccountRepository.js';
import { InMemoryDebridDownloadRepository } from '../../../src/infrastructure/persistence/InMemoryDebridDownloadRepository.js';
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
// Only the scheduler exists on this fake box; every other catalogued file is
// absent, which is exactly the "component not installed" case.
class OneFileOnDisk implements ConfigFileReaderPort {
  read(document: ConfigDocument): Promise<ConfigFileContent | undefined> {
    return Promise.resolve(
      document.id === 'scheduler'
        ? { content: '*/5 * * * * root /usr/local/bin/kobox send-mails\n', truncated: false }
        : undefined,
    );
  }
}

// Reversible marker instead of real RSA: a test can then prove the portal
// stored something SEALED, and which password it sealed, without a key pair.
export const REMOTE_SEAL_PREFIX = 'rsealed:';

class FakeRemoteSealer implements RemotePasswordSealerPort {
  seal(password: RemotePassword): Promise<string> {
    return Promise.resolve(`${REMOTE_SEAL_PREFIX}${password.reveal()}`);
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

// Stands in for RSA sealing: reversible marker, so a test can assert the portal
// never emits the PLAINTEXT key while still proving it sealed the right one.
export const SEAL_PREFIX = 'sealed:';

class FakeDebridEncryptor implements DebridKeyEncryptorPort {
  encrypt(key: DebridApiKey): Promise<string> {
    return Promise.resolve(Buffer.from(`${SEAL_PREFIX}${key.reveal()}`).toString('base64'));
  }
}

export interface PortalWorld {
  readonly server: FastifyInstance;
  readonly users: InMemoryUserRepository;
  readonly credentials: InMemoryPortalCredentialsRepository;
  readonly sessions: InMemoryPortalSessionRepository;
  readonly queue: RecordingQueue;
  readonly outbox: InMemoryMailOutbox;
  readonly downloads: InMemoryDebridDownloadRepository;
  readonly debridAccounts: InMemoryDebridAccountRepository;
  readonly media: InMemoryMediaRepository;
  readonly fairUse: InMemoryFairUseRepository;
  readonly diagnostics: InMemoryDiagnosticsRepository;
  readonly instances: InMemoryTorrentInstanceRepository;
  readonly diskSamples: InMemoryDiskUsageRepository;
  readonly sshKeys: InMemorySshKeyRepository;
  readonly components: InMemoryComponentRegistry;
  readonly mailRelay: InMemoryMailRelayRepository;
  readonly siteSettings: InMemorySiteSettingsRepository;
  readonly destinations: InMemorySyncDestinationRepository;
  readonly transfers: InMemorySyncTransferRepository;
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
  const downloads = new InMemoryDebridDownloadRepository();
  const debridAccounts = new InMemoryDebridAccountRepository();
  // the portal seals with the public half only; this fake makes that visible
  const debridEncryptor = new FakeDebridEncryptor();
  const media = new InMemoryMediaRepository();
  const fairUse = new InMemoryFairUseRepository();
  const diagnostics = new InMemoryDiagnosticsRepository();
  const instances = new InMemoryTorrentInstanceRepository();
  const diskSamples = new InMemoryDiskUsageRepository();
  const sshKeys = new InMemorySshKeyRepository();
  const components = new InMemoryComponentRegistry();
  const mailRelay = new InMemoryMailRelayRepository();
  const siteSettings = new InMemorySiteSettingsRepository();
  const destinations = new InMemorySyncDestinationRepository();
  const transfers = new InMemorySyncTransferRepository();
  const authDeps = { users, credentials, sessions, attempts, tokens, hasher };
  const server = buildPortalServer({
    login: new Login(authDeps),
    logout: new Logout(authDeps),
    authenticate: new Authenticate(authDeps),
    issueAppToken: new IssueAppToken({ credentials, tokens, clock: () => NOW }),
    authenticateApp: new AuthenticateApp({
      credentials,
      attempts,
      tokens,
      clock: () => NOW,
    }),
    now: () => NOW,
    users,
    queue,
    hasher,
    trackers: new InMemoryTrackerRepository(),
    blocklists: new InMemoryBlocklistRepository(),
    addresses: new InMemoryUserAddressRepository(),
    bindings: new InMemoryUserAddressRepository(),
    fairUse,
    health: new AllHealthyProbe(),
    components,
    speedtests: new InMemorySpeedtestRepository(),
    diagnostics,
    configFiles: new OneFileOnDisk(),
    instances,
    diskSamples,
    mailRelay,
    siteSettings,
    sealer: new FakeRemoteSealer(),
    sshKeys,
    destinations,
    transfers,
    setDestination: new SetSyncDestination({ destinations, sealer: new FakeRemoteSealer() }),
    releases: new InMemoryReleaseRepository(),
    outbox,
    credentials,
    profiles: new NoProfiles(),
    downloads,
    requestDownload: new RequestDebridDownload({ repo: downloads, queue, clock: () => NOW }),
    debridAccounts,
    debridEncryptor,
    media,
    ...extra,
  });
  await users.save(new UserBuilder().build());
  await credentials.save(
    { username: Username.parse('alice'), passwordHash: GOOD_HASH, role: 'user' },
    NOW,
  );
  // alice runs an instance with one category, the shape every member has
  const provisioned = TorrentInstance.provision({
    username: Username.parse('alice'),
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45000),
  }).instance;
  await instances.save(provisioned.addWatchDir(Label.parse('films')).instance);
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
  return { server, users, credentials, sessions, queue, outbox, downloads, debridAccounts, media, fairUse, diagnostics, instances, diskSamples, sshKeys, components, mailRelay, siteSettings, destinations, transfers };
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
