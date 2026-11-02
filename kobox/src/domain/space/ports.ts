import type { AutomaticCleanup } from './AutomaticCleanup.js';
import type { CleanupCandidate } from './CleanupCandidate.js';
import type { CleanupReport, CleanupTrigger } from './CleanupReport.js';
import type { FinishedTorrent } from './FinishedTorrent.js';
import type { BoxSeedRule, SeedRule } from './SeedRule.js';
import type { SeedRuleChoice } from './SeedRuleChoice.js';
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
  get(): Promise<BoxSeedRule>;
  save(rule: BoxSeedRule): Promise<void>;
}

// What a member could clean, as the hourly pass last judged it, and the rule
// it judged by: the page words each reason after that rule, not after one the
// member chose since. No candidate with a time still says something: the pass
// ran and found nothing to clean.
export interface CleanupSnapshot {
  readonly candidates: readonly CleanupCandidate[];
  readonly takenAt: string;
  readonly judgedBy: SeedRule;
}

// The latest cleanup snapshot of each member: the root worker writes it, the
// non-root portal reads it, since only root can ask a member's rTorrent.
export interface CleanupSnapshotRepository {
  replace(
    username: Username,
    candidates: readonly CleanupCandidate[],
    takenAt: string,
    judgedBy: SeedRule,
  ): Promise<void>;
  find(username: Username): Promise<CleanupSnapshot | undefined>;
}

// The latest cleanup report of each member for each trigger, so the page can
// say what went and a cleanup by hand does not hide from the home what KoBox
// deleted on its own. Saving a report replaces only the one of its trigger.
export interface CleanupReportRepository {
  save(username: Username, report: CleanupReport): Promise<void>;
  // the most recent report, whoever started it
  find(username: Username): Promise<CleanupReport | undefined>;
  findTriggeredBy(username: Username, trigger: CleanupTrigger): Promise<CleanupReport | undefined>;
}

// What a member chose for their space and where the critical-line mail stands:
// whether KoBox may clean on its own, and whether the member was already
// warned during the climb they are in.
export interface SpacePreferences {
  readonly automatic: AutomaticCleanup;
  readonly warned: boolean;
}

// Each member's space preferences. A member who never chose anything has
// automatic cleanup off, was never warned, and keeps the box's seed rule. Each
// is written apart, leaving the others as they were: the member makes the
// choices, the hourly pass records the warning.
export interface SpacePreferenceRepository {
  find(username: Username): Promise<SpacePreferences>;
  chooseAutomatic(username: Username, automatic: AutomaticCleanup): Promise<void>;
  recordWarned(username: Username, warned: boolean): Promise<void>;
  findSeedRule(username: Username): Promise<SeedRuleChoice>;
  chooseSeedRule(username: Username, choice: SeedRuleChoice): Promise<void>;
}
