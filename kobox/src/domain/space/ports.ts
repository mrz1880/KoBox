import type { CleanupCandidate } from './CleanupCandidate.js';
import type { CleanupReport } from './CleanupReport.js';
import type { FinishedTorrent } from './FinishedTorrent.js';
import type { SeedRule } from './SeedRule.js';
import type { InfoHash } from '../torrent/InfoHash.js';
import type { ScgiPort } from '../user/Port.js';
import type { Username } from '../user/Username.js';

// What the space context needs from a member's rTorrent: the torrents whose
// data is complete, with what they take and what they gave back, and a way to
// drop one. Erasing leaves the data on disk: removing it is another port's job.
export interface MemberTorrentsPort {
  listFinished(scgiPort: ScgiPort): Promise<readonly FinishedTorrent[]>;
  erase(scgiPort: ScgiPort, infoHash: InfoHash): Promise<void>;
}

// Erases what a torrent left on disk once rTorrent let go of it. Only a path
// inside the member's own downloads may go: anything else is refused with
// `PathOutsideMemberSpaceError`, and a path already gone counts as removed.
export interface TorrentDataPort {
  remove(username: Username, path: string): Promise<void>;
}

// The box-wide seed rule an admin set, or the default while none was.
export interface SeedRuleRepository {
  get(): Promise<SeedRule>;
  save(rule: SeedRule): Promise<void>;
}

// What a member could clean, as the hourly pass last judged it. No candidate
// with a time still says something: the pass ran and found nothing to clean.
export interface CleanupSnapshot {
  readonly candidates: readonly CleanupCandidate[];
  readonly takenAt: string;
}

// The latest cleanup snapshot of each member: the root worker writes it, the
// non-root portal reads it, since only root can ask a member's rTorrent.
export interface CleanupSnapshotRepository {
  replace(
    username: Username,
    candidates: readonly CleanupCandidate[],
    takenAt: string,
  ): Promise<void>;
  find(username: Username): Promise<CleanupSnapshot | undefined>;
}

// The latest cleanup report of each member, so the page can say what went.
export interface CleanupReportRepository {
  save(username: Username, report: CleanupReport): Promise<void>;
  find(username: Username): Promise<CleanupReport | undefined>;
}
