import type { InfoHash } from './InfoHash.js';

// One download as rTorrent's hash queue sees it: whether it sits in the queue
// (ruTorrent shows it "Queued"), and whether it is the one being checked.
export interface HashQueueEntry {
  readonly infoHash: InfoHash;
  readonly inQueue: boolean;
  readonly checking: boolean;
}

// What a pass does about a stalled queue: restart what was already stalled at
// the previous pass, watch what only just looks stalled.
export interface StallVerdict {
  readonly restart: readonly InfoHash[];
  readonly watch: readonly InfoHash[];
}

function among(hashes: readonly InfoHash[], infoHash: InfoHash): boolean {
  return hashes.some((other) => other.equals(infoHash));
}

/**
 * A member's rTorrent hash queue. rTorrent checks one download at a time, so
 * while downloads wait one is always being checked. Seen on 2026-11-11 with
 * rTorrent 0.9.8: a download dropped into a watch folder waited a day in a
 * queue where nothing was checked, until its member started it by hand. The
 * cause was not reproduced; the stall is what this recognises.
 */
export class HashQueue {
  private constructor(private readonly entries: readonly HashQueueEntry[]) {}

  static of(entries: readonly HashQueueEntry[]): HashQueue {
    return new HashQueue([...entries]);
  }

  /** The downloads waiting in a queue where none is being checked. */
  stalled(): readonly InfoHash[] {
    if (this.entries.some((entry) => entry.checking)) {
      return [];
    }
    return this.entries.filter((entry) => entry.inQueue).map((entry) => entry.infoHash);
  }

  /**
   * A download between two checks can look stalled for an instant, so only
   * one already stalled at the previous pass is restarted.
   *
   * @param previouslyStalled what the previous pass found stalled
   * @returns what to restart now, and what to look at again next pass
   */
  verdictAfter(previouslyStalled: readonly InfoHash[]): StallVerdict {
    const stalled = this.stalled();
    return {
      restart: stalled.filter((infoHash) => among(previouslyStalled, infoHash)),
      watch: stalled.filter((infoHash) => !among(previouslyStalled, infoHash)),
    };
  }
}
