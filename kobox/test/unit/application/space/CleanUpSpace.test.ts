import { beforeEach, describe, expect, it } from 'vitest';
import { CleanUpSpace } from '../../../../src/application/space/CleanUpSpace.js';
import { TakeCleanupSnapshot } from '../../../../src/application/space/TakeCleanupSnapshot.js';
import type { FinishedTorrent } from '../../../../src/domain/space/FinishedTorrent.js';
import { SeedRule } from '../../../../src/domain/space/SeedRule.js';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { SyncTransfer } from '../../../../src/domain/sync/SyncTransfer.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryCleanupReportRepository } from '../../../../src/infrastructure/persistence/InMemoryCleanupReportRepository.js';
import { InMemoryCleanupSnapshotRepository } from '../../../../src/infrastructure/persistence/InMemoryCleanupSnapshotRepository.js';
import { InMemoryDiskUsageRepository } from '../../../../src/infrastructure/persistence/InMemoryDiskUsageRepository.js';
import { InMemoryMailOutbox } from '../../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { InMemorySpacePreferenceRepository } from '../../../../src/infrastructure/persistence/InMemorySpacePreferenceRepository.js';
import { InMemorySeedRuleRepository } from '../../../../src/infrastructure/persistence/InMemorySeedRuleRepository.js';
import { InMemorySyncTransferRepository } from '../../../../src/infrastructure/persistence/InMemorySyncTransferRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { FakeMemberTorrents } from '../../../../src/infrastructure/system/fakes/FakeMemberTorrents.js';
import { FakeQuota } from '../../../../src/infrastructure/system/fakes/FakeQuota.js';
import { FakeTorrentData } from '../../../../src/infrastructure/system/fakes/FakeTorrentData.js';
import { aUser } from '../../../builders/UserBuilder.js';

const alice = Username.parse('alice');
const aliceScgi = ScgiPort.parse(51101);
// the worker's clock: a stamp, UTC to the second
const AT = '2026-11-20 12:00:00';

const FILM = InfoHash.parse('A'.repeat(40));
const FILM_PATH = '/home/alice/rtorrent/complete/Films/Example Film';
const ALBUM = InfoHash.parse('B'.repeat(40));
const ALBUM_PATH = '/home/alice/rtorrent/complete/Example Album';

// finished long ago and seeded far beyond the default rule
function seededFilm(overrides: Partial<FinishedTorrent> = {}): FinishedTorrent {
  return {
    infoHash: FILM,
    name: 'Example Film',
    size: Quota.gib(12),
    ratio: 3,
    finishedAt: '2026-10-01T08:00:00.000Z',
    path: FILM_PATH,
    ...overrides,
  };
}

function seededAlbum(): FinishedTorrent {
  return seededFilm({
    infoHash: ALBUM,
    name: 'Example Album',
    size: Quota.gib(1),
    path: ALBUM_PATH,
  });
}

// barely seeded: only having been sent can make it cleanable
function freshFilm(): FinishedTorrent {
  return seededFilm({ ratio: 0.2, finishedAt: '2026-11-19T08:00:00.000Z' });
}

async function queued(
  transfers: InMemorySyncTransferRepository,
  path: string,
): Promise<SyncTransfer> {
  const transfer = await transfers.queue(
    SyncTransfer.queue({
      username: alice,
      label: Label.parse('Films'),
      source: LocalPath.parse(path),
      queuedAt: AT,
    }),
  );
  if (transfer === undefined) {
    throw new Error(`${path} was already queued`);
  }
  return transfer;
}

async function sent(transfers: InMemorySyncTransferRepository, path: string): Promise<void> {
  await transfers.save((await queued(transfers, path)).start(AT).succeed(AT));
}

async function beingSent(transfers: InMemorySyncTransferRepository, path: string): Promise<void> {
  await transfers.save((await queued(transfers, path)).start(AT));
}

interface World {
  instances: InMemoryTorrentInstanceRepository;
  transfers: InMemorySyncTransferRepository;
  torrents: FakeMemberTorrents;
  data: FakeTorrentData;
  quota: FakeQuota;
  samples: InMemoryDiskUsageRepository;
  reports: InMemoryCleanupReportRepository;
  snapshots: InMemoryCleanupSnapshotRepository;
  preferences: InMemorySpacePreferenceRepository;
  outbox: InMemoryMailOutbox;
  cleanUp: CleanUpSpace;
}

let world: World;

beforeEach(async () => {
  const instances = new InMemoryTorrentInstanceRepository();
  await instances.save(
    TorrentInstance.provision({
      username: alice,
      scgiPort: aliceScgi,
      rtorrentPort: RtorrentPort.parse(45000),
    }).instance,
  );
  const deps = {
    instances,
    torrents: new FakeMemberTorrents(),
    data: new FakeTorrentData(),
    transfers: new InMemorySyncTransferRepository(),
    seedRule: new InMemorySeedRuleRepository(),
    preferences: new InMemorySpacePreferenceRepository(),
    quota: new FakeQuota(),
    samples: new InMemoryDiskUsageRepository(),
    reports: new InMemoryCleanupReportRepository(),
    snapshots: new InMemoryCleanupSnapshotRepository(),
    outbox: new InMemoryMailOutbox(),
    clock: () => AT,
  };
  const users = new InMemoryUserRepository();
  await users.save(aUser().build());
  world = {
    ...deps,
    cleanUp: new CleanUpSpace({
      ...deps,
      snapshot: new TakeCleanupSnapshot(deps),
      mail: {
        users,
        credentials: new InMemoryPortalCredentialsRepository(),
        address: { baseUrl: () => Promise.resolve('https://box.example.org') },
        outbox: deps.outbox,
      },
    }),
  };
});

describe('CleanUpSpace', () => {
  it('should_erase_a_picked_torrent_that_still_qualifies_and_remove_its_files', async () => {
    world.torrents.holds(aliceScgi, [seededFilm()]);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    expect(world.torrents.erased).toEqual([FILM.value]);
    expect(world.data.removed).toEqual([{ username: 'alice', path: FILM_PATH }]);
  });

  it('should_erase_a_picked_torrent_sync_already_sent_even_if_barely_seeded', async () => {
    world.torrents.holds(aliceScgi, [freshFilm()]);
    await sent(world.transfers, FILM_PATH);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    expect(world.torrents.erased).toEqual([FILM.value]);
  });

  // the box asks a ratio of 2 over a week: alice only asks two weeks
  it('should_recheck_a_picked_torrent_against_the_rule_the_member_set', async () => {
    await world.preferences.chooseSeedRule(alice, {
      kind: 'own',
      rule: SeedRule.of({ days: 14 }),
    });
    world.torrents.holds(aliceScgi, [
      seededFilm({ ratio: 0.3, finishedAt: '2026-11-05T08:00:00.000Z' }),
    ]);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    expect(world.torrents.erased).toEqual([FILM.value]);
    expect(world.data.removed).toEqual([{ username: 'alice', path: FILM_PATH }]);
  });

  it('should_keep_a_torrent_the_box_rule_would_keep_for_a_member_without_a_rule', async () => {
    world.torrents.holds(aliceScgi, [
      seededFilm({ ratio: 0.3, finishedAt: '2026-11-05T08:00:00.000Z' }),
    ]);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    expect(world.torrents.erased).toEqual([]);
  });

  // restarted since the snapshot: its ratio is back under the rule
  it('should_keep_a_picked_torrent_that_no_longer_qualifies_and_say_why', async () => {
    world.torrents.holds(aliceScgi, [freshFilm()]);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    expect(world.torrents.erased).toEqual([]);
    expect(world.data.removed).toEqual([]);
    expect((await world.reports.find(alice))?.skipped).toEqual([
      { name: 'Example Film', reason: 'noLongerQualifies' },
    ]);
  });

  // sync started sending it since the snapshot: deleting it now would cut the
  // copy on the member's machine short
  it('should_keep_a_picked_torrent_now_being_sent_and_say_why', async () => {
    world.torrents.holds(aliceScgi, [seededFilm()]);
    await beingSent(world.transfers, FILM_PATH);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    expect(world.torrents.erased).toEqual([]);
    expect(world.data.removed).toEqual([]);
    expect((await world.reports.find(alice))?.skipped).toEqual([
      { name: 'Example Film', reason: 'noLongerQualifies' },
    ]);
  });

  // erased by hand, or back to downloading, since the snapshot
  it('should_skip_a_picked_torrent_rtorrent_no_longer_lists_as_finished', async () => {
    const gone = InfoHash.parse('C'.repeat(40));
    world.torrents.holds(aliceScgi, [seededFilm()]);

    await world.cleanUp.execute({ username: alice, infoHashes: [gone], trigger: 'member' });

    expect(world.torrents.erased).toEqual([]);
    expect((await world.reports.find(alice))?.skipped).toEqual([
      { name: gone.value, reason: 'gone' },
    ]);
  });

  it('should_report_every_picked_torrent_as_gone_for_a_member_without_an_rtorrent', async () => {
    await world.instances.delete(alice);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    expect((await world.reports.find(alice))?.skipped).toEqual([
      { name: FILM.value, reason: 'gone' },
    ]);
  });

  it('should_report_what_went_with_the_space_it_gave_back', async () => {
    world.torrents.holds(aliceScgi, [seededFilm()]);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    const report = await world.reports.find(alice);
    expect(report?.deleted).toEqual([{ name: 'Example Film', size: Quota.gib(12) }]);
    expect(report?.freed.toGib()).toBe(12);
    expect(report?.at).toBe(AT);
    expect(report?.trigger).toBe('member');
    // the member is on the page that shows it: no mail
    expect(await world.outbox.listRecent(10)).toEqual([]);
  });

  // the member did not ask: they hear what went and what it gave back
  it('should_mail_the_member_what_an_automatic_cleanup_deleted_and_the_space_it_gave_back', async () => {
    world.torrents.holds(aliceScgi, [seededFilm(), seededAlbum()]);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM, ALBUM], trigger: 'automatic' });

    expect((await world.reports.find(alice))?.trigger).toBe('automatic');
    const mails = await world.outbox.listRecent(10);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.recipient).toBe('alice@example.org');
    expect(mails[0]?.body).toContain('Example Film');
    expect(mails[0]?.body).toContain('Example Album');
    expect(mails[0]?.body).toContain('13,0 Gio');
  });

  // its files are never removed under a torrent rTorrent still holds
  it('should_leave_the_files_of_a_torrent_rtorrent_refused_to_drop_and_go_on', async () => {
    world.torrents.holds(aliceScgi, [seededFilm(), seededAlbum()]);
    world.torrents.refusesToErase(FILM);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM, ALBUM], trigger: 'member' });

    expect(world.data.removed).toEqual([{ username: 'alice', path: ALBUM_PATH }]);
    const report = await world.reports.find(alice);
    expect(report?.skipped).toEqual([{ name: 'Example Film', reason: 'notErased' }]);
    expect(report?.deleted.map((line) => line.name)).toEqual(['Example Album']);
  });

  // no silent retry on data: the folder stays visible in Files
  it('should_report_files_it_could_not_remove_and_go_on', async () => {
    world.torrents.holds(aliceScgi, [seededFilm(), seededAlbum()]);
    world.data.refusesToRemove(FILM_PATH);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM, ALBUM], trigger: 'member' });

    expect(world.torrents.erased).toEqual([FILM.value, ALBUM.value]);
    const report = await world.reports.find(alice);
    expect(report?.skipped).toEqual([{ name: 'Example Film', reason: 'dataKept' }]);
    expect(report?.deleted.map((line) => line.name)).toEqual(['Example Album']);
  });

  // the home gauge reads this sample: it must not wait for the hourly pass
  it('should_measure_the_members_usage_again_once_done', async () => {
    world.torrents.holds(aliceScgi, [seededFilm()]);
    world.quota.setUsageForTest(alice, Quota.gib(20));

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    const sample = await world.samples.find(alice);
    expect(sample?.used.toGib()).toBe(20);
    expect(sample?.sampledAt).toBe(AT);
  });

  // the page lists the snapshot: what went must not still be offered
  it('should_judge_what_the_member_can_clean_again_once_done', async () => {
    world.torrents.holds(aliceScgi, [seededFilm(), seededAlbum()]);

    await world.cleanUp.execute({ username: alice, infoHashes: [FILM], trigger: 'member' });

    const snapshot = await world.snapshots.find(alice);
    expect(snapshot?.takenAt).toBe(AT);
    expect(snapshot?.candidates.map((candidate) => candidate.name)).toEqual(['Example Album']);
  });
});
