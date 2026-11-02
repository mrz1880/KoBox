import { Quota } from '../user/Quota.js';

// Why a torrent the member picked is still on the box:
// - noLongerQualifies: judged again live, it no longer meets the rule (restarted,
//   ratio dropped, being sent);
// - gone: rTorrent no longer lists it among the finished torrents;
// - notErased: rTorrent refused to drop it, so its files were left alone;
// - dataKept: rTorrent dropped it but its files could not be removed, and stay
//   visible in Files.
export const SKIP_REASONS = ['noLongerQualifies', 'gone', 'notErased', 'dataKept'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface DeletedLine {
  readonly name: string;
  readonly size: Quota;
}

// A torrent rTorrent no longer lists has no name to show: its info hash stands in.
export interface SkippedLine {
  readonly name: string;
  readonly reason: SkipReason;
}

// What one cleanup did for a member: what went, what stayed and why, and when.
export class CleanupReport {
  private constructor(
    readonly deleted: readonly DeletedLine[],
    readonly skipped: readonly SkippedLine[],
    readonly at: string,
  ) {}

  static of(lines: {
    readonly deleted: readonly DeletedLine[];
    readonly skipped: readonly SkippedLine[];
    readonly at: string;
  }): CleanupReport {
    return new CleanupReport([...lines.deleted], [...lines.skipped], lines.at);
  }

  // the space given back: what was deleted, never what was only asked for
  get freed(): Quota {
    return Quota.total(this.deleted.map((line) => line.size));
  }
}
