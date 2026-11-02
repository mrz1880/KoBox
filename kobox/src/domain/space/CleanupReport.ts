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

// Whether a reason means the box failed to remove what the member picked, as
// opposed to the pick no longer applying. A record rather than a list: a new
// reason does not compile until someone decides which side it falls on.
const IS_A_FAILURE: Readonly<Record<SkipReason, boolean>> = {
  noLongerQualifies: false,
  gone: false,
  notErased: true,
  dataKept: true,
};

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

  // what the box could not remove: the member is told, and so is whoever
  // looks after the box
  get failures(): readonly SkippedLine[] {
    return this.skipped.filter((line) => IS_A_FAILURE[line.reason]);
  }

  // the space given back: what was deleted, never what was only asked for
  get freed(): Quota {
    return Quota.total(this.deleted.map((line) => line.size));
  }
}
