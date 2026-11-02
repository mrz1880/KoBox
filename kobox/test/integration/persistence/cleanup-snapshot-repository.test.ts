import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CleanupCandidate } from '../../../src/domain/space/CleanupCandidate.js';
import { InfoHash } from '../../../src/domain/torrent/InfoHash.js';
import { Quota } from '../../../src/domain/user/Quota.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteCleanupSnapshotRepository } from '../../../src/infrastructure/persistence/SqliteCleanupSnapshotRepository.js';

const alice = Username.parse('alice');
const bob = Username.parse('bob');

const film = CleanupCandidate.restore({
  infoHash: InfoHash.parse('A'.repeat(40)),
  name: 'Example Film',
  // above 4 GiB: the bytes must survive SQLite as an integer
  size: Quota.gib(12),
  ratio: 2.45,
  finishedAt: '2026-10-20T08:00:00.000Z',
  path: '/home/alice/rtorrent/complete/films/Example Film',
  reason: 'seeded',
});

const album = CleanupCandidate.restore({
  infoHash: InfoHash.parse('B'.repeat(40)),
  name: 'Example Album',
  size: Quota.bytes(2048),
  ratio: 0.5,
  finishedAt: '2026-10-31T21:00:00.000Z',
  path: '/home/alice/rtorrent/complete/Example Album',
  reason: 'alreadySent',
});

let dir: string;
let db: KoboxDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-cleanup-snapshots-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteCleanupSnapshotRepository', () => {
  it('should_know_nothing_of_a_member_whose_snapshot_was_never_taken', async () => {
    expect(await new SqliteCleanupSnapshotRepository(db).find(alice)).toBeUndefined();
  });

  it('should_give_back_the_candidates_of_the_latest_snapshot_with_its_time', async () => {
    const repo = new SqliteCleanupSnapshotRepository(db);

    await repo.replace(alice, [film, album], '2026-11-02T09:00:00.000Z');

    expect(await repo.find(alice)).toEqual({
      candidates: [film, album],
      takenAt: '2026-11-02T09:00:00.000Z',
    });
  });

  it('should_drop_the_candidates_of_the_previous_snapshot_when_a_new_one_is_taken', async () => {
    const repo = new SqliteCleanupSnapshotRepository(db);
    await repo.replace(alice, [film, album], '2026-11-02T09:00:00.000Z');

    await repo.replace(alice, [album], '2026-11-02T10:00:00.000Z');

    expect(await repo.find(alice)).toEqual({
      candidates: [album],
      takenAt: '2026-11-02T10:00:00.000Z',
    });
  });

  // "looked, nothing to clean" is not "never looked": the page says which
  it('should_keep_the_time_of_a_snapshot_that_found_nothing_to_clean', async () => {
    const repo = new SqliteCleanupSnapshotRepository(db);
    await repo.replace(alice, [film], '2026-11-02T09:00:00.000Z');

    await repo.replace(alice, [], '2026-11-02T10:00:00.000Z');

    expect(await repo.find(alice)).toEqual({ candidates: [], takenAt: '2026-11-02T10:00:00.000Z' });
  });

  it('should_keep_each_member_snapshot_apart', async () => {
    const repo = new SqliteCleanupSnapshotRepository(db);
    await repo.replace(alice, [film], '2026-11-02T09:00:00.000Z');

    await repo.replace(bob, [], '2026-11-02T09:05:00.000Z');

    expect(await repo.find(alice)).toEqual({
      candidates: [film],
      takenAt: '2026-11-02T09:00:00.000Z',
    });
  });
});
