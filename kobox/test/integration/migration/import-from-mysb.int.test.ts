import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaimedJob } from '../../../src/application/jobs/JobQueuePort.js';
import { ImportFromMysb } from '../../../src/application/migration/ImportFromMysb.js';
import { CreateUser } from '../../../src/application/user/CreateUser.js';
import { SuspendUser } from '../../../src/application/user/SuspendUser.js';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../src/domain/user/Password.js';
import { ScgiPort } from '../../../src/domain/user/Port.js';
import type { PasswordHasherPort } from '../../../src/domain/user/ports.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteBlocklistRepository } from '../../../src/infrastructure/persistence/SqliteBlocklistRepository.js';
import { SqliteJobQueue } from '../../../src/infrastructure/persistence/SqliteJobQueue.js';
import { SqliteMailOutbox } from '../../../src/infrastructure/persistence/SqliteMailOutbox.js';
import { SqliteMysbDumpSource } from '../../../src/infrastructure/persistence/SqliteMysbDumpSource.js';
import { SqlitePortAllocator } from '../../../src/infrastructure/persistence/SqlitePortAllocator.js';
import { SqlitePortalCredentialsRepository } from '../../../src/infrastructure/persistence/SqlitePortalCredentialsRepository.js';
import { SqlitePortalSessionRepository } from '../../../src/infrastructure/persistence/SqlitePortalSessionRepository.js';
import { SqliteTorrentInstanceRepository } from '../../../src/infrastructure/persistence/SqliteTorrentInstanceRepository.js';
import { SqliteTorrentRepository } from '../../../src/infrastructure/persistence/SqliteTorrentRepository.js';
import { SqliteTrackerRepository } from '../../../src/infrastructure/persistence/SqliteTrackerRepository.js';
import { SqliteUserAddressRepository } from '../../../src/infrastructure/persistence/SqliteUserAddressRepository.js';
import { SqliteUserRepository } from '../../../src/infrastructure/persistence/SqliteUserRepository.js';
import { FakeNotifications } from '../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeQuota } from '../../../src/infrastructure/system/fakes/FakeQuota.js';
import { FakeServiceControl } from '../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeSftp } from '../../../src/infrastructure/system/fakes/FakeSftp.js';
import { FakeSystemAccounts } from '../../../src/infrastructure/system/fakes/FakeSystemAccounts.js';
import { buildDump } from '../../fixtures/migration/buildDump.js';

const FIXED_HASH = HashedPassword.parse('$6$importsalt$0123456789abcdefghijklmnopqrstuvwxyzABCDE');

class FakeHasher implements PasswordHasherPort {
  hash(): Promise<HashedPassword> {
    return Promise.resolve(FIXED_HASH);
  }

  verify(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

let dbDir: string;
let dumpDir: string;
let db: KoboxDatabase;

function buildImporter(): { importer: ImportFromMysb; queue: SqliteJobQueue; outbox: SqliteMailOutbox } {
  const users = new SqliteUserRepository(db);
  const accounts = new FakeSystemAccounts();
  const notifications = new FakeNotifications();
  const credentials = new SqlitePortalCredentialsRepository(db);
  const sftp = new FakeSftp();
  const clock = (): string => '2026-07-26 12:00:00';
  const createUser = new CreateUser({
    repo: users,
    accounts,
    quota: new FakeQuota(),
    sftp,
    notifications,
    allocator: new SqlitePortAllocator(db),
    credentials,
    clock,
  });
  const suspendUser = new SuspendUser({
    repo: users,
    accounts,
    sftp,
    services: new FakeServiceControl(),
    notifications,
    sessions: new SqlitePortalSessionRepository(db),
  });
  const addresses = new SqliteUserAddressRepository(db);
  const queue = new SqliteJobQueue(db);
  const outbox = new SqliteMailOutbox(db);
  const importer = new ImportFromMysb({
    source: new SqliteMysbDumpSource(dumpDir),
    users,
    createUser,
    suspendUser,
    instances: new SqliteTorrentInstanceRepository(db),
    trackers: new SqliteTrackerRepository(db),
    blocklists: new SqliteBlocklistRepository(db),
    torrents: new SqliteTorrentRepository(db),
    addresses,
    bindings: addresses,
    hasher: new FakeHasher(),
    newTemporaryPassword: () => Password.parse('temp-secret-9x'),
    outbox,
    queue,
    clock,
  });
  return { importer, queue, outbox };
}

async function drainTypes(queue: SqliteJobQueue): Promise<string[]> {
  const types: string[] = [];
  let claimed: ClaimedJob | undefined;
  while ((claimed = await queue.claimNextPending()) !== undefined) {
    types.push(claimed.job.type);
    await queue.markDone(claimed.id);
  }
  return types;
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'kobox-import-db-'));
  db = KoboxDatabase.open(join(dbDir, 'kobox.db'));
  dumpDir = buildDump({
    users: [
      {
        username: 'alice',
        email: 'alice@example.org',
        scgiPort: 51101,
        rtorrentPort: 45000,
        categories: [{ name: 'Films', syncMode: 0 }, { name: 'Autres', syncMode: 0 }],
      },
      {
        username: 'bob',
        email: 'bob@example.org',
        scgiPort: 51102,
        rtorrentPort: 45001,
        active: 0,
      },
    ],
    trackers: [
      {
        host: 'tracker.example.org',
        proto: 'https',
        port: 443,
        privacy: 'private',
        ipv4: ['192.0.2.10'],
      },
    ],
    torrents: [
      {
        username: 'alice',
        infoHash: 'a'.repeat(40),
        name: 'Some.Neutral.Release',
        label: 'movies',
        state: 'completed',
      },
    ],
    addresses: [{ username: 'alice', value: '192.0.2.50', kind: 'ipv4' }],
  });
});

afterEach(() => {
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(dumpDir, { recursive: true, force: true });
});

describe('ImportFromMysb over real SQLite', () => {
  it('should_write_the_full_import_and_preserve_ports_flags_and_forced_reset', async () => {
    const { importer, queue, outbox } = buildImporter();

    const report = await importer.execute({ apply: true });

    expect([...report.users.created].sort()).toEqual(['alice', 'bob']);

    const users = new SqliteUserRepository(db);
    const alice = await users.findByUsername(Username.parse('alice'));
    expect(alice?.scgiPort.value).toBe(51101);
    expect(alice?.rtorrentPort.value).toBe(45000);
    expect(alice?.status.isSuspended()).toBe(false);

    // the inactive legacy user is restored suspended
    expect((await users.findByUsername(Username.parse('bob')))?.status.isSuspended()).toBe(true);

    // forced reset + preserved sync flag survive a real SQLite round-trip
    const credentials = new SqlitePortalCredentialsRepository(db);
    expect((await credentials.find(Username.parse('alice')))?.mustChangePassword).toBe(true);
    const instances = new SqliteTorrentInstanceRepository(db);
    expect((await instances.findByUsername(Username.parse('alice')))?.syncDisabled).toBe(true);

    // the member's folders come across with them. Without this they arrive on a
    // box with no folders at all: their torrents carry labels pointing at
    // directories that do not exist, and every sync choice they made is gone.
    const alicesFolders = (await instances.findByUsername(Username.parse('alice')))?.watchDirs ?? [];
    // read back sorted by name; what matters is which folders exist and what
    // each one does with a finished download
    expect(
      alicesFolders
        .filter((dir) => dir.label !== undefined)
        .map((dir) => `${dir.label?.value ?? ''}=${dir.syncMode.value}`),
    ).toEqual(['Autres=off', 'Films=off']);

    // catalogue + per-user data landed
    expect(await new SqliteTrackerRepository(db).listAll()).toHaveLength(1);
    expect(await new SqliteTorrentRepository(db).listFor(Username.parse('alice'))).toHaveLength(1);
    expect(await new SqliteUserAddressRepository(db).listAll()).toHaveLength(1);

    // provisioning was enqueued for each user
    const types = await drainTypes(queue);
    expect(types.filter((t) => t === 'provision-rtorrent')).toHaveLength(2);

    // each user got exactly one temporary-password mail
    expect(await outbox.listRecent(10)).toHaveLength(2);
  });

  it('should_seed_the_port_ledger_so_a_later_allocation_skips_the_imported_ports', async () => {
    const { importer } = buildImporter();
    await importer.execute({ apply: true });

    // 51101/51102 are claimed by alice/bob; the next allocation must step over them
    const next = await new SqlitePortAllocator(db).allocateScgiPort();
    expect(next.value).toBe(51103);
    // and claiming an imported port again is refused
    await expect(new SqlitePortAllocator(db).claimScgiPort(ScgiPort.parse(51101))).rejects.toThrow();
  });

  it('should_be_re_entrant_importing_no_duplicates_on_a_second_apply', async () => {
    const first = buildImporter();
    await first.importer.execute({ apply: true });

    const second = buildImporter();
    const report = await second.importer.execute({ apply: true });

    expect(report.users.created).toEqual([]);
    expect([...report.users.alreadyImported].sort()).toEqual(['alice', 'bob']);
    expect(await new SqliteUserRepository(db).listAll()).toHaveLength(2);
    expect(await new SqliteTrackerRepository(db).listAll()).toHaveLength(1);
  });
});
