import type { CleanupCandidate } from './CleanupCandidate.js';
import { QuotaPressure } from './QuotaPressure.js';
import type { InfoHash } from '../torrent/InfoHash.js';
import { Quota } from '../user/Quota.js';

export interface ProposalLine {
  readonly candidate: CleanupCandidate;
  readonly checked: boolean;
}

// The largest first, since each line frees the most space a click can give
// back; among equal sizes, the most seeded first, since it owes the trackers
// the least.
function byLargestThenMostSeeded(a: CleanupCandidate, b: CleanupCandidate): number {
  return b.size.toBytes() - a.size.toBytes() || b.ratio - a.ratio;
}

// What a member is offered to delete: every candidate, in order, with the
// first ones checked until deleting them brings the member back to the line
// where filling starts. The member can still change the boxes.
export class CleanupProposal {
  private constructor(readonly lines: readonly ProposalLine[]) {}

  static of(member: {
    readonly candidates: readonly CleanupCandidate[];
    readonly used: Quota;
    readonly allowance: Quota;
  }): CleanupProposal {
    const target = QuotaPressure.targetUsage(member.allowance);
    // what the member would still use once every line checked so far is gone
    let usageLeft = member.used;
    const lines = [...member.candidates].sort(byLargestThenMostSeeded).map((candidate) => {
      const checked = !usageLeft.fitsWithin(target);
      if (checked) {
        usageLeft = usageLeft.remainingAfter(candidate.size);
      }
      return { candidate, checked };
    });
    return new CleanupProposal(lines);
  }

  // The same lines with the boxes the member left checked instead. A picked
  // hash that is not a line of this proposal checks nothing.
  pick(selection: readonly InfoHash[]): CleanupProposal {
    return new CleanupProposal(
      this.lines.map((line) => ({
        candidate: line.candidate,
        checked: selection.some((infoHash) => infoHash.equals(line.candidate.infoHash)),
      })),
    );
  }

  // Everything that could go, checked or not: what an admin reads as the
  // member's cleanable space.
  cleanable(): Quota {
    return Quota.total(this.lines.map((line) => line.candidate.size));
  }

  // What deleting frees: the lines checked by the proposal, or the ones the
  // member picked once they changed the boxes.
  freed(selection?: readonly InfoHash[]): Quota {
    const lines = selection === undefined ? this.lines : this.pick(selection).lines;
    return Quota.total(lines.filter((line) => line.checked).map((line) => line.candidate.size));
  }
}
