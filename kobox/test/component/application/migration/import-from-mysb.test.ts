import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '../../../../src/application/jobs/contract.js';
import type { ClaimedJob, JobQueuePort } from '../../../../src/application/jobs/JobQueuePort.js';
import { ImportFromMysb } from '../../../../src/application/migration/ImportFromMysb.js';
import type {
  MysbAddress,
  MysbBlocklist,
  MysbSource,
  MysbTorrent,
  MysbTracker,
  MysbUser,
} from '../../../../src/application/migration/MysbSourcePort.js';
import { CreateUser } from '../../../../src/application/user/CreateUser.js';
import { SuspendUser } from '../../../../src/application/user/SuspendUser.js';
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../../src/domain/user/Password.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import type { PasswordHasherPort } from '../../../../src/domain/user/ports.js';
import type { PortAllocatorPort } from '../../../../src/domain/user/PortAllocatorPort.js';
import { PortAlreadyClaimedError } from '../../../../src/domain/user/PortAllocatorPort.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryBlocklistRepository } from '../../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { InMemoryMailOutbox } from '../../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryPortalSessionRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalSessionRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryTorrentRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentRepository.js';
import { InMemoryTrackerRepository } from '../../../../src/infrastructure/persistence/InMemoryTrackerRepository.js';
import { InMemoryUserAddressRepository } from '../../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNotifications } from '../../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeQuota } from '../../../../src/infrastructure/system/fakes/FakeQuota.js';
import { FakeServiceControl } from '../../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeSftp } from '../../../../src/infrastructure/system/fakes/FakeSftp.js';
import { FakeSystemAccounts } from '../../../../src/infrastructure/system/fakes/FakeSystemAccounts.js';

const FIXED_HASH = HashedPassword.parse('$6$importsalt$0123456789abcdefghijklmnopqrstuvwxyzABCDE');

class FakeHasher implements PasswordHasherPort {
  hash(_password: Password): Promise<HashedPassword> {
    return Promise.resolve(FIXED_HASH);
  }

  verify(_password: Password, _hash: HashedPassword): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class RecordingQueue implements JobQueuePort {
  readonly jobs: Job[] = [];

  enqueue(job: Job): Promise<number> {
    this.jobs.push(job);
    return Promise.resolve(this.jobs.length);
  }

  enqueueUnique(job: Job): Promise<number | undefined> {
    return this.enqueue(job);
  }

  claimNextPending(): Promise<ClaimedJob | undefined> {
    return Promise.resolve(undefined);
  }

  markDone(): Promise<void> {
    return Promise.resolve();
  }

  markFailed(): Promise<void> {
    return Promise.resolve();
  }

  recoverStale(): Promise<number> {
    return Promise.resolve(0);
  }
}

class SequentialPortAllocator implements PortAllocatorPort {
  private nextScgi = 51101;
  private nextRtorrent = 45000;
  private readonly claimed = new Set<number>();

  allocateScgiPort(): Promise<ScgiPort> {
    while (this.claimed.has(this.nextScgi)) this.nextScgi += 1;
    return Promise.resolve(ScgiPort.parse(this.nextScgi++));
  }

  allocateRtorrentPort(): Promise<RtorrentPort> {
    while (this.claimed.has(this.nextRtorrent)) this.nextRtorrent += 1;
    return Promise.resolve(RtorrentPort.parse(this.nextRtorrent++));
  }

  releaseScgiPort(port: ScgiPort): Promise<void> {
    this.claimed.delete(port.value);
    return Promise.resolve();
  }

  releaseRtorrentPort(port: RtorrentPort): Promise<void> {
    this.claimed.delete(port.value);
    return Promise.resolve();
  }

  claimScgiPort(port: ScgiPort): Promise<void> {
    return this.claim(port.value);
  }

  claimRtorrentPort(port: RtorrentPort): Promise<void> {
    return this.claim(port.value);
  }

  private claim(value: number): Promise<void> {
    if (this.claimed.has(value)) return Promise.reject(new PortAlreadyClaimedError(value));
    this.claimed.add(value);
    return Promise.resolve();
  }
}

class FakeMysbSource implements MysbSource {
  constructor(
    private readonly data: {
      users?: readonly MysbUser[];
      trackers?: readonly MysbTracker[];
      blocklists?: readonly MysbBlocklist[];
      torrents?: readonly MysbTorrent[];
      addresses?: readonly MysbAddress[];
    },
  ) {}

  users(): Promise<readonly MysbUser[]> {
    return Promise.resolve(this.data.users ?? []);
  }

  trackers(): Promise<readonly MysbTracker[]> {
    return Promise.resolve(this.data.trackers ?? []);
  }

  blocklists(): Promise<readonly MysbBlocklist[]> {
    return Promise.resolve(this.data.blocklists ?? []);
  }

  torrents(): Promise<readonly MysbTorrent[]> {
    return Promise.resolve(this.data.torrents ?? []);
  }

  addresses(): Promise<readonly MysbAddress[]> {
    return Promise.resolve(this.data.addresses ?? []);
  }
}

const aliceDto: MysbUser = {
  username: 'alice',
  email: 'alice@example.org',
  scgiPort: 51101,
  rtorrentPort: 45000,
  proxyPort: 8080,
  quotaBytes: 442_381_107_200,
  accountType: 'normal',
  active: true,
  syncDisabled: false,
};
const trackerDto: MysbTracker = {
  host: 'tracker.example.org',
  proto: 'https',
  port: 443,
  privacy: 'private',
  isActive: true,
  isDead: false,
  isSsl: true,
  ipv4: ['192.0.2.10'],
};
const blocklistDto: MysbBlocklist = {
  source: 'iblocklist',
  author: 'level1',
  name: 'Level 1',
  url: 'https://lists.example.net/level1.gz',
  subscription: true,
  enabled: true,
};
const torrentDto: MysbTorrent = {
  username: 'alice',
  infoHash: 'a'.repeat(40),
  name: 'Some.Neutral.Release',
  label: 'movies',
  state: 'completed',
};
const addressDto: MysbAddress = { username: 'alice', value: '192.0.2.50', kind: 'ipv4' };

function buildWorld(source: MysbSource) {
  const users = new InMemoryUserRepository();
  const accounts = new FakeSystemAccounts();
  const quota = new FakeQuota();
  const sftp = new FakeSftp();
  const services = new FakeServiceControl();
  const notifications = new FakeNotifications();
  const credentials = new InMemoryPortalCredentialsRepository();
  const sessions = new InMemoryPortalSessionRepository();
  const allocator = new SequentialPortAllocator();
  const clock = (): string => '2026-07-26 12:00:00';
  const createUser = new CreateUser({
    repo: users,
    accounts,
    quota,
    sftp,
    notifications,
    allocator,
    credentials,
    clock,
  });
  const suspendUser = new SuspendUser({ repo: users, accounts, sftp, services, notifications, sessions });
  const instances = new InMemoryTorrentInstanceRepository();
  const trackers = new InMemoryTrackerRepository();
  const blocklists = new InMemoryBlocklistRepository();
  const torrents = new InMemoryTorrentRepository();
  const addresses = new InMemoryUserAddressRepository();
  const outbox = new InMemoryMailOutbox();
  const queue = new RecordingQueue();
  const importer = new ImportFromMysb({
    source,
    users,
    createUser,
    suspendUser,
    instances,
    trackers,
    blocklists,
    torrents,
    addresses,
    bindings: addresses,
    hasher: new FakeHasher(),
    newTemporaryPassword: () => Password.parse('temp-secret-9x'),
    outbox,
    queue,
    clock,
  });
  return { users, credentials, instances, trackers, blocklists, torrents, addresses, outbox, queue, importer };
}

const alice = Username.parse('alice');

describe('ImportFromMysb', () => {
  let world: ReturnType<typeof buildWorld>;

  describe('dry-run', () => {
    beforeEach(() => {
      world = buildWorld(
        new FakeMysbSource({
          users: [aliceDto],
          trackers: [trackerDto],
          blocklists: [blocklistDto],
          torrents: [torrentDto],
          addresses: [addressDto],
        }),
      );
    });

    it('should_report_without_writing_anything', async () => {
      const report = await world.importer.execute({ apply: false });

      expect(report.apply).toBe(false);
      expect(report.users.created).toEqual(['alice']);
      expect(await world.users.findByUsername(alice)).toBeUndefined();
      expect(await world.trackers.listAll()).toHaveLength(0);
      expect(world.queue.jobs).toHaveLength(0);
      expect(await world.outbox.listRecent(10)).toHaveLength(0);
    });
  });

  describe('apply', () => {
    it('should_provision_a_user_with_preserved_ports_a_forced_reset_and_the_sync_flag', async () => {
      world = buildWorld(
        new FakeMysbSource({
          users: [{ ...aliceDto, scgiPort: 51105, rtorrentPort: 45005, syncDisabled: true }],
        }),
      );

      const report = await world.importer.execute({ apply: true });

      expect(report.users.created).toEqual(['alice']);
      const user = await world.users.findByUsername(alice);
      expect(user?.scgiPort.value).toBe(51105);
      expect(user?.rtorrentPort.value).toBe(45005);
      expect((await world.credentials.find(alice))?.mustChangePassword).toBe(true);
      const instance = await world.instances.findByUsername(alice);
      expect(instance?.syncDisabled).toBe(true);
      expect(instance?.scgiPort.value).toBe(51105);
    });

    it('should_enqueue_provisioning_and_mail_a_temporary_password', async () => {
      world = buildWorld(new FakeMysbSource({ users: [aliceDto] }));

      await world.importer.execute({ apply: true });

      const jobTypes = world.queue.jobs.map((job) => job.type);
      expect(jobTypes).toContain('provision-rtorrent');
      expect(jobTypes).toContain('provision-vpn-user');
      expect(jobTypes).toContain('render-nfs-exports');
      const mails = await world.outbox.listRecent(10);
      expect(mails).toHaveLength(1);
      expect(mails[0]?.recipient).toBe('alice@example.org');
      // owner decision: the temporary password is mailed (never in the jobs DB)
      expect(mails[0]?.body).toContain('temp-secret-9x');
    });

    it('should_import_trackers_and_blocklists', async () => {
      world = buildWorld(new FakeMysbSource({ trackers: [trackerDto], blocklists: [blocklistDto] }));

      await world.importer.execute({ apply: true });

      expect(await world.trackers.listAll()).toHaveLength(1);
      expect(await world.blocklists.listAll()).toHaveLength(1);
    });

    it('should_import_data_only_for_known_users_and_flag_orphans', async () => {
      world = buildWorld(
        new FakeMysbSource({
          users: [aliceDto],
          torrents: [torrentDto, { ...torrentDto, username: 'ghost' }],
          addresses: [addressDto],
        }),
      );

      const report = await world.importer.execute({ apply: true });

      expect(await world.torrents.listFor(alice)).toHaveLength(1);
      expect(report.torrents.conflicts.some((c) => c.key.includes('ghost'))).toBe(true);
    });

    it('should_suspend_an_inactive_user_after_creating_it', async () => {
      world = buildWorld(new FakeMysbSource({ users: [{ ...aliceDto, active: false }] }));

      await world.importer.execute({ apply: true });

      expect((await world.users.findByUsername(alice))?.status.isSuspended()).toBe(true);
    });

    it('should_flag_a_conflicting_row_and_import_the_rest', async () => {
      world = buildWorld(
        new FakeMysbSource({
          users: [
            aliceDto,
            { ...aliceDto, username: 'root', email: 'root@example.org', scgiPort: 51106, rtorrentPort: 45006 },
          ],
        }),
      );

      const report = await world.importer.execute({ apply: true });

      expect(report.users.created).toEqual(['alice']);
      expect(report.users.conflicts).toHaveLength(1);
      expect(report.users.conflicts[0]?.key).toBe('root');
      expect(await world.users.findByUsername(alice)).toBeDefined();
    });

    it('should_be_idempotent_creating_no_second_user_or_mail', async () => {
      world = buildWorld(new FakeMysbSource({ users: [aliceDto] }));

      await world.importer.execute({ apply: true });
      const provisions = (): number =>
        world.queue.jobs.filter((job) => job.type === 'provision-rtorrent').length;
      const firstProvisions = provisions();
      const firstMails = (await world.outbox.listRecent(50)).length;

      const report = await world.importer.execute({ apply: true });

      expect(report.users.created).toEqual([]);
      expect(report.users.alreadyImported).toEqual(['alice']);
      expect(provisions()).toBe(firstProvisions);
      expect((await world.outbox.listRecent(50)).length).toBe(firstMails);
    });
  });
});
