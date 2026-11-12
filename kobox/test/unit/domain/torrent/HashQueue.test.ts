import { describe, expect, it } from 'vitest';
import { HashQueue, type HashQueueEntry } from '../../../../src/domain/torrent/HashQueue.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';

const A = InfoHash.parse('A'.repeat(40));
const B = InfoHash.parse('B'.repeat(40));
const C = InfoHash.parse('C'.repeat(40));

function waiting(infoHash: InfoHash): HashQueueEntry {
  return { infoHash, inQueue: true, checking: false };
}

function checking(infoHash: InfoHash): HashQueueEntry {
  return { infoHash, inQueue: true, checking: true };
}

function idle(infoHash: InfoHash): HashQueueEntry {
  return { infoHash, inQueue: false, checking: false };
}

describe('HashQueue', () => {
  // rTorrent checks one download at a time: one is always being checked while
  // others wait, unless the queue stalled
  it.each<[string, readonly HashQueueEntry[], readonly InfoHash[]]>([
    ['downloads wait and none is checked', [waiting(A), idle(B), waiting(C)], [A, C]],
    ['one is being checked while another waits', [checking(A), waiting(B)], []],
    ['nothing waits', [idle(A), idle(B)], []],
  ])('should_find_the_queue_stalled_only_when_%s', (_situation, entries, stalled) => {
    expect(HashQueue.of(entries).stalled()).toEqual(stalled);
  });

  // a download between two checks looks stalled for an instant: only one seen
  // stalled at the previous pass too is restarted, the others are watched
  it('should_restart_only_what_was_already_stalled_at_the_previous_pass', () => {
    const verdict = HashQueue.of([waiting(A), waiting(B)]).verdictAfter([A, C]);

    expect(verdict).toEqual({ restart: [A], watch: [B] });
  });
});
