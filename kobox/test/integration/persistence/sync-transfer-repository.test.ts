import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalPath } from '../../../src/domain/sync/LocalPath.js';
import { SyncTransfer } from '../../../src/domain/sync/SyncTransfer.js';
import { Label } from '../../../src/domain/torrent/Label.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteSyncTransferRepository } from '../../../src/infrastructure/persistence/SqliteSyncTransferRepository.js';

const alice = Username.parse('alice');
const bob = Username.parse('bob');
const films = Label.parse('Films');
const AT = '2026-11-02 10:00:00';

let dir: string;
let db: KoboxDatabase;
let repo: SqliteSyncTransferRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-transfers-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  repo = new SqliteSyncTransferRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function queued(username: Username, source: string): Promise<SyncTransfer> {
  const transfer = await repo.queue(
    SyncTransfer.queue({ username, label: films, source: LocalPath.parse(source), queuedAt: AT }),
  );
  if (transfer === undefined) {
    throw new Error(`${source} was already queued`);
  }
  return transfer;
}

describe('SqliteSyncTransferRepository', () => {
  it('should_list_only_what_reached_the_members_machine_and_only_theirs', async () => {
    const sent = await queued(alice, '/home/alice/rtorrent/complete/Films/Example Film');
    await repo.save(sent.start(AT).succeed(AT));
    const failed = await queued(alice, '/home/alice/rtorrent/complete/Films/Example Show');
    await repo.save(failed.start(AT).fail('connection refused', AT));
    await queued(alice, '/home/alice/rtorrent/complete/Films/Example Clip');
    const bobs = await queued(bob, '/home/bob/rtorrent/complete/Films/Example Film');
    await repo.save(bobs.start(AT).succeed(AT));

    const sources = await repo.listSentSources(alice);

    expect(sources.map((source) => source.value)).toEqual([
      '/home/alice/rtorrent/complete/Films/Example Film',
    ]);
  });

  it('should_list_what_is_waiting_being_sent_or_failed_and_only_theirs', async () => {
    const sent = await queued(alice, '/home/alice/rtorrent/complete/Films/Example Film');
    await repo.save(sent.start(AT).succeed(AT));
    const failed = await queued(alice, '/home/alice/rtorrent/complete/Films/Example Show');
    await repo.save(failed.start(AT).fail('connection refused', AT));
    const sending = await queued(alice, '/home/alice/rtorrent/complete/Films/Example Album');
    await repo.save(sending.start(AT));
    await queued(alice, '/home/alice/rtorrent/complete/Films/Example Clip');
    await queued(bob, '/home/bob/rtorrent/complete/Films/Example Film');

    const sources = await repo.listUnsettledSources(alice);

    expect(sources.map((source) => source.value)).toEqual([
      '/home/alice/rtorrent/complete/Films/Example Show',
      '/home/alice/rtorrent/complete/Films/Example Album',
      '/home/alice/rtorrent/complete/Films/Example Clip',
    ]);
  });
});
