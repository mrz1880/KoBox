import type { FinishedTorrent } from './FinishedTorrent.js';
import type { SeedRule } from './SeedRule.js';
import type { InfoHash } from '../torrent/InfoHash.js';
import type { Quota } from '../user/Quota.js';

// Why a torrent may go: it gave back enough, or KoBox sync already put a copy
// on the member's own machine.
export type CleanupReason = 'seeded' | 'alreadySent';

type CompleteTorrent = FinishedTorrent & { readonly finishedAt: string };

// A finished torrent a member could delete to free space, with the reason the
// page shows them. Only `judge` builds a new one, so a candidate always has a
// reason that held when it was judged; `restore` reads one back from storage.
export class CleanupCandidate {
  readonly infoHash: InfoHash;
  readonly name: string;
  readonly size: Quota;
  readonly ratio: number;
  readonly finishedAt: string;
  readonly path: string;
  readonly reason: CleanupReason;

  private constructor(torrent: CompleteTorrent, reason: CleanupReason) {
    this.infoHash = torrent.infoHash;
    this.name = torrent.name;
    this.size = torrent.size;
    this.ratio = torrent.ratio;
    this.finishedAt = torrent.finishedAt;
    this.path = torrent.path;
    this.reason = reason;
  }

  // Brings back a candidate judged earlier, as stored with its reason.
  static restore(
    judged: CompleteTorrent & { readonly reason: CleanupReason },
  ): CleanupCandidate {
    return new CleanupCandidate(judged, judged.reason);
  }

  // A torrent still downloading is never proposed, even if a partial copy was
  // sent. Having been sent wins over having seeded: a copy on the member's
  // machine is the stronger reassurance before deleting.
  static judge(
    torrent: FinishedTorrent,
    context: {
      readonly rule: SeedRule;
      readonly sentPaths: ReadonlySet<string>;
      readonly now: string;
    },
  ): CleanupCandidate | undefined {
    const { finishedAt } = torrent;
    if (finishedAt === undefined) {
      return undefined;
    }
    const complete = { ...torrent, finishedAt };
    if (context.sentPaths.has(complete.path)) {
      return new CleanupCandidate(complete, 'alreadySent');
    }
    return context.rule.isMetBy(complete, context.now)
      ? new CleanupCandidate(complete, 'seeded')
      : undefined;
  }
}
