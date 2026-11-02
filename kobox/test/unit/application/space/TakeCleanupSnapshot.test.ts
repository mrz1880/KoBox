import { beforeEach, describe, expect, it } from 'vitest';
import { TakeCleanupSnapshot } from '../../../../src/application/space/TakeCleanupSnapshot.js';
import type { FinishedTorrent } from '../../../../src/domain/space/FinishedTorrent.js';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { SyncTransfer } from '../../../../src/domain/sync/SyncTransfer.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryCleanupSnapshotRepository } from '../../../../src/infrastructure/persistence/InMemoryCleanupSnapshotRepository.js';
import { InMemorySeedRuleRepository } from '../../../../src/infrastructure/persistence/InMemorySeedRuleRepository.js';
import { InMemorySyncTransferRepository } from '../../../../src/infrastructure/persistence/InMemorySyncTransferRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { FakeMemberTorrents } from '../../../../src/infrastructure/system/fakes/FakeMemberTorrents.js';

const alice = Username.parse('alice');
const aliceScgi = ScgiPort.parse(51101);
// the worker's clock: a stamp, UTC to the second
const AT = '2026-11-20 12:00:00';

// finished long ago and seeded far beyond the default rule
function seededFilm(overrides: Partial<FinishedTorrent> = {}): FinishedTorrent {
  return {
    infoHash: InfoHash.parse('A'.repeat(40)),
    name: 'Example Film',
    size: Quota.gib(12),
    ratio: 3,
    finishedAt: '2026-10-01T08:00:00.000Z',
    path: '/home/alice/rtorrent/complete/Films/Example Film',
    ...overrides,
  };
}

// barely seeded: only having been sent can make it cleanable
function freshFilm(path: string): FinishedTorrent {
  return seededFilm({ ratio: 0.2, finishedAt: '2026-11-19T08:00:00.000Z', path });
}

// a download KoBox sync took to the member's machine: its source is what the
// `finished` hook gave as d.base_path, parsed into a LocalPath
async function sent(transfers: InMemorySyncTransferRepository, basePath: string): Promise<void> {
  const queued = await transfers.queue(
    SyncTransfer.queue({
      username: alice,
      label: Label.parse('Films'),
      source: LocalPath.parse(basePath),
      queuedAt: AT,
    }),
  );
  if (queued === undefined) {
    throw new Error(`${basePath} was already queued`);
  }
  await transfers.save(queued.start(AT).succeed(AT));
}

interface World {
  instances: InMemoryTorrentInstanceRepository;
  torrents: FakeMemberTorrents;
  transfers: InMemorySyncTransferRepository;
  seedRule: InMemorySeedRuleRepository;
  snapshots: InMemoryCleanupSnapshotRepository;
  take: TakeCleanupSnapshot;
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
    transfers: new InMemorySyncTransferRepository(),
    seedRule: new InMemorySeedRuleRepository(),
    snapshots: new InMemoryCleanupSnapshotRepository(),
  };
  world = { ...deps, take: new TakeCleanupSnapshot(deps) };
});

describe('TakeCleanupSnapshot', () => {
  it('should_keep_what_the_member_can_clean_with_when_it_was_judged', async () => {
    world.torrents.holds(aliceScgi, [seededFilm()]);

    await expect(world.take.execute(alice, AT)).resolves.toEqual({ kind: 'taken' });

    const snapshot = await world.snapshots.find(alice);
    expect(snapshot?.takenAt).toBe(AT);
    expect(snapshot?.candidates.map((candidate) => [candidate.name, candidate.reason])).toEqual([
      ['Example Film', 'seeded'],
    ]);
  });

  it('should_propose_a_download_sync_already_sent_to_the_members_machine', async () => {
    const path = '/home/alice/rtorrent/complete/Films/Example Film';
    world.torrents.holds(aliceScgi, [freshFilm(path)]);
    await sent(world.transfers, path);

    await world.take.execute(alice, AT);

    const snapshot = await world.snapshots.find(alice);
    expect(snapshot?.candidates.map((candidate) => candidate.reason)).toEqual(['alreadySent']);
  });

  // the source went through LocalPath, d.base_path did not: both are compared
  // in the same form
  it('should_match_a_sent_download_whatever_trailing_slash_rtorrent_gave', async () => {
    const path = '/home/alice/rtorrent/complete/Films/Example Film';
    world.torrents.holds(aliceScgi, [freshFilm(`${path}/`)]);
    await sent(world.transfers, path);

    await world.take.execute(alice, AT);

    const snapshot = await world.snapshots.find(alice);
    expect(snapshot?.candidates.map((candidate) => candidate.reason)).toEqual(['alreadySent']);
  });

  // the page shows the previous snapshot with its date, which says how old it is
  it('should_keep_the_previous_snapshot_when_the_members_rtorrent_does_not_answer', async () => {
    world.torrents.holds(aliceScgi, [seededFilm()]);
    await world.take.execute(alice, '2026-11-20 11:00:00');
    world.torrents.goesDown(aliceScgi);

    await expect(world.take.execute(alice, AT)).resolves.toEqual({
      kind: 'rtorrentSilent',
      error: 'rtorrent SCGI on 51101 does not answer',
    });

    const snapshot = await world.snapshots.find(alice);
    expect(snapshot?.takenAt).toBe('2026-11-20 11:00:00');
    expect(snapshot?.candidates).toHaveLength(1);
  });

  it('should_keep_the_previous_snapshot_of_a_member_without_an_rtorrent', async () => {
    await world.snapshots.replace(alice, [], '2026-11-20 11:00:00');
    await world.instances.delete(alice);

    await expect(world.take.execute(alice, AT)).resolves.toEqual({ kind: 'noRtorrent' });

    expect((await world.snapshots.find(alice))?.takenAt).toBe('2026-11-20 11:00:00');
  });
});
