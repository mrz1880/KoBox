import { candidatesAllowedBy } from '../../domain/space/AutomaticCleanup.js';
import type { CleanupCandidate } from '../../domain/space/CleanupCandidate.js';
import { CleanupProposal } from '../../domain/space/CleanupProposal.js';
import type {
  CleanupSnapshot,
  CleanupSnapshotRepository,
  SpacePreferenceRepository,
  SpacePreferences,
} from '../../domain/space/ports.js';
import { QuotaPressure } from '../../domain/space/QuotaPressure.js';
import { SpaceWarning } from '../../domain/space/SpaceWarning.js';
import { instantOf, shiftStamp } from '../../domain/shared/stamp.js';
import type { Quota } from '../../domain/user/Quota.js';
import type { SeedboxUser } from '../../domain/user/SeedboxUser.js';
import { CLEANUP_MAX_TORRENTS, parseJob } from '../jobs/contract.js';
import type { JobQueuePort } from '../jobs/JobQueuePort.js';
import { SpaceMailer, type SpaceMailerDeps } from './SpaceMailer.js';

interface Deps {
  readonly preferences: SpacePreferenceRepository;
  readonly snapshots: Pick<CleanupSnapshotRepository, 'find'>;
  readonly queue: Pick<JobQueuePort, 'enqueue'>;
  readonly mail: SpaceMailerDeps;
}

// A list older than this was not refreshed by the last passes (the member's
// rTorrent stopped answering): KoBox no longer deletes from it on its own.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

interface WatchedMember {
  readonly user: SeedboxUser;
  readonly used: Quota;
}

// Looks at a member's space once the hourly pass measured it. A member who
// chose to clean as soon as their rule allows has everything their choice
// covers deleted, whatever their space. Past the critical line, once per
// climb, KoBox either cleans up for a member who chose it, or mails them what
// they can free and where. A member who chose automatic cleanup still gets the
// mail when nothing their choice covers can go, so they never believe they are
// covered when they are not.
export class WatchMemberSpace {
  private readonly mailer: SpaceMailer;

  constructor(private readonly deps: Deps) {
    this.mailer = new SpaceMailer(deps.mail);
  }

  // `at` is the worker's stamp.
  async execute(member: WatchedMember, at: string): Promise<void> {
    const { user, used } = member;
    const preferences = await this.deps.preferences.find(user.username);
    const snapshot = await this.deps.snapshots.find(user.username);
    // what the rule allowed is already on its way out: past the line too, the
    // member is covered by it rather than cleaned for twice
    const cleanedByRule = await this.cleanUpWhatTheRuleAllows(member, preferences, snapshot, at);
    const step = SpaceWarning.after(preferences.warned, QuotaPressure.of(used, user.quota));
    if (step.send && !cleanedByRule) {
      if (!(await this.cleanUpFor(member, preferences, snapshot, at))) {
        await this.mailer.runningOut(
          user.username,
          { used, allowance: user.quota, freeable: proposalFor(member, snapshot?.candidates ?? []).freed() },
          at,
        );
      }
    }
    // written once the member was told or the cleanup queued: either one that
    // failed is tried again at the next pass rather than lost for the climb.
    // A cleanup queued counts as the warning, so a member it leaves past the
    // line is not cleaned for again every hour until they climb anew.
    if (step.warned !== preferences.warned) {
      await this.deps.preferences.recordWarned(user.username, step.warned);
    }
  }

  // Queues, for a member who chose it, the cleanup of everything their choice
  // covers, and tells whether it did.
  private async cleanUpWhatTheRuleAllows(
    member: WatchedMember,
    preferences: SpacePreferences,
    snapshot: CleanupSnapshot | undefined,
    at: string,
  ): Promise<boolean> {
    if (preferences.timing !== 'onceRuleMet' || snapshot === undefined) {
      return false;
    }
    // a copy already sent to the member's machine still seeds until the rule
    // lets it go: that is what the member asked for
    const now = instantOf(at);
    const due = allowedFrom(preferences, snapshot, at).filter((candidate) =>
      snapshot.judgedBy.isMetBy(candidate, now),
    );
    const every = proposalFor(member, due).lines.map((line) => line.candidate);
    return this.queueCleanup(member, every, 'ruleMet');
  }

  // Queues the cleanup the member chose, on what their choice covers, and
  // tells whether it did.
  private async cleanUpFor(
    member: WatchedMember,
    preferences: SpacePreferences,
    snapshot: CleanupSnapshot | undefined,
    at: string,
  ): Promise<boolean> {
    const checked = proposalFor(member, allowedFrom(preferences, snapshot, at))
      .lines.filter((line) => line.checked)
      .map((line) => line.candidate);
    return this.queueCleanup(member, checked, 'automatic');
  }

  private async queueCleanup(
    member: WatchedMember,
    candidates: readonly CleanupCandidate[],
    trigger: 'automatic' | 'ruleMet',
  ): Promise<boolean> {
    const picked = candidates
      .map((candidate) => candidate.infoHash.value)
      // the largest come first, so what one job cannot carry is the least
      .slice(0, CLEANUP_MAX_TORRENTS);
    if (picked.length === 0) {
      return false;
    }
    await this.deps.queue.enqueue(
      parseJob('clean-up-space', { username: member.user.username.value, infoHashes: picked, trigger }),
    );
    return true;
  }
}

// What the member's choice lets KoBox delete on its own, from a list fresh
// enough to delete from: nothing while automatic cleanup is off.
function allowedFrom(
  preferences: SpacePreferences,
  snapshot: CleanupSnapshot | undefined,
  at: string,
): readonly CleanupCandidate[] {
  if (
    preferences.automatic === 'off' ||
    snapshot === undefined ||
    // both are stamps, which compare as strings in time
    snapshot.takenAt < shiftStamp(at, -STALE_AFTER_MS)
  ) {
    return [];
  }
  return candidatesAllowedBy(preferences.automatic, snapshot.candidates);
}

function proposalFor(member: WatchedMember, candidates: readonly CleanupCandidate[]): CleanupProposal {
  return CleanupProposal.of({ candidates, used: member.used, allowance: member.user.quota });
}
