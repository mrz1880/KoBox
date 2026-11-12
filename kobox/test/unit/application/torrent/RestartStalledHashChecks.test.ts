import { beforeEach, describe, expect, it } from 'vitest';
import { RestartStalledHashChecks } from '../../../../src/application/torrent/RestartStalledHashChecks.js';
import type { HashQueueEntry } from '../../../../src/domain/torrent/HashQueue.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import type { SeedboxUser } from '../../../../src/domain/user/SeedboxUser.js';
import { InMemoryStalledHashCheckRepository } from '../../../../src/infrastructure/persistence/InMemoryStalledHashCheckRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeHashQueue } from '../../../../src/infrastructure/system/fakes/FakeHashQueue.js';
import { aUser } from '../../../builders/UserBuilder.js';

const A = InfoHash.parse('A'.repeat(40));
const B = InfoHash.parse('B'.repeat(40));
const ALICE_SCGI = 51101;
const BOB_SCGI = 51102;

function waiting(infoHash: InfoHash): HashQueueEntry {
  return { infoHash, inQueue: true, checking: false };
}

let alice: SeedboxUser;
let bob: SeedboxUser;
let queue: FakeHashQueue;
let restartStalled: RestartStalledHashChecks;

async function withRtorrent(
  users: InMemoryUserRepository,
  instances: InMemoryTorrentInstanceRepository,
  user: SeedboxUser,
  scgiPort: number,
): Promise<void> {
  await users.save(user);
  await instances.save(
    TorrentInstance.provision({
      username: user.username,
      scgiPort: ScgiPort.parse(scgiPort),
      rtorrentPort: RtorrentPort.parse(45000 + scgiPort - ALICE_SCGI),
    }).instance,
  );
}

beforeEach(async () => {
  alice = aUser().withUsername('alice').build();
  bob = aUser().withUsername('bob').build();
  const users = new InMemoryUserRepository();
  const instances = new InMemoryTorrentInstanceRepository();
  await withRtorrent(users, instances, alice, ALICE_SCGI);
  await withRtorrent(users, instances, bob, BOB_SCGI);
  queue = new FakeHashQueue();
  restartStalled = new RestartStalledHashChecks({
    users,
    instances,
    hashQueue: queue,
    stalls: new InMemoryStalledHashCheckRepository(),
  });
});

describe('RestartStalledHashChecks', () => {
  // seen on 2026-11-11: a download waited a day in a queue where nothing was
  // checked, until its member started it by hand
  it('should_restart_a_download_still_waiting_in_a_stalled_queue_at_the_next_pass', async () => {
    queue.holds(ALICE_SCGI, [waiting(A)]);
    const first = await restartStalled.execute();

    const second = await restartStalled.execute();

    expect(first.restarted).toEqual([]);
    expect(second.restarted).toEqual([{ username: alice.username, infoHash: A }]);
    expect(queue.restarted).toEqual([{ scgiPort: ALICE_SCGI, infoHash: A.value }]);
  });

  it('should_leave_a_download_whose_queue_moved_on_since_the_previous_pass', async () => {
    queue.holds(ALICE_SCGI, [waiting(A), waiting(B)]);
    await restartStalled.execute();
    queue.holds(ALICE_SCGI, [{ infoHash: A, inQueue: true, checking: true }, waiting(B)]);

    const pass = await restartStalled.execute();

    expect(pass.restarted).toEqual([]);
    expect(queue.restarted).toEqual([]);
  });

  // one member's rTorrent not answering costs no other member their check
  it('should_go_on_with_the_other_members_when_an_rtorrent_does_not_answer', async () => {
    queue.holds(ALICE_SCGI, [waiting(A)]);
    queue.silent(BOB_SCGI, new Error('connect ECONNREFUSED'));
    await restartStalled.execute();

    const pass = await restartStalled.execute();

    expect(pass.restarted).toEqual([{ username: alice.username, infoHash: A }]);
    expect(pass.unreadable).toEqual([{ username: bob.username, error: 'connect ECONNREFUSED' }]);
  });
});
