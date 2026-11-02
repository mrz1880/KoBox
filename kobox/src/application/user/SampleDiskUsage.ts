import type { CleanupSnapshotOutcome, TakeCleanupSnapshot } from '../space/TakeCleanupSnapshot.js';
import type { WatchMemberSpace } from '../space/WatchMemberSpace.js';
import type { Username } from '../../domain/user/Username.js';
import type {
  DiskUsageRepository,
  QuotaGaugePort,
  QuotaPort,
  UserRepository,
  VolumePort,
  VolumeSampleRepository,
} from '../../domain/user/ports.js';

interface Deps {
  readonly repo: UserRepository;
  readonly quota: QuotaPort;
  readonly samples: DiskUsageRepository;
  readonly gauges: QuotaGaugePort;
  readonly volume: VolumePort;
  readonly volumeSamples: VolumeSampleRepository;
  readonly cleanupSnapshot: Pick<TakeCleanupSnapshot, 'execute'>;
  readonly spaceWatch: Pick<WatchMemberSpace, 'execute'>;
  readonly clock: () => string;
}

// A member whose cleanup list stayed as it was although they have an rTorrent:
// they only see an older date, so the operator is the one told why.
export interface StaleCleanupSnapshot {
  readonly username: Username;
  readonly cause: 'rtorrentSilent' | 'failed';
  readonly error: string;
}

// What a member's snapshot attempt came to, a throw included.
type SnapshotAttempt = CleanupSnapshotOutcome | { readonly kind: 'failed'; readonly error: string };

// The attempts that left a stale list, without a catch-all: a new outcome does
// not compile until it is classified here.
function staleness(attempt: SnapshotAttempt): Omit<StaleCleanupSnapshot, 'username'> | undefined {
  switch (attempt.kind) {
    case 'taken':
    case 'noRtorrent':
      return undefined;
    case 'rtorrentSilent':
    case 'failed':
      return { cause: attempt.kind, error: attempt.error };
  }
}

// A member whose space was measured but not watched: they may have missed the
// critical-line mail or their automatic cleanup, so the operator is told.
export interface UnwatchedMember {
  readonly username: Username;
  readonly error: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// What a pass could not do although it went on.
export interface DiskUsagePass {
  readonly staleSnapshots: readonly StaleCleanupSnapshot[];
  readonly unwatched: readonly UnwatchedMember[];
}

// Writes down what the disk holds for each member, on a schedule, because the
// portal runs non-root and cannot ask about an account that is not its own.
// One member's unreadable quota must not cost the others their reading, so a
// failure is skipped rather than propagated. The volume all of them share is
// read once per pass, and an unreadable volume is skipped the same way. Each
// sampled member also gets their cleanup snapshot, for the same reason, and
// the pass returns whose list could not be refreshed for the caller to log.
export class SampleDiskUsage {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<DiskUsagePass> {
    const at = this.deps.clock();
    const staleSnapshots: StaleCleanupSnapshot[] = [];
    const unwatched: UnwatchedMember[] = [];
    const space = await this.deps.volume.measure().catch(() => undefined);
    if (space !== undefined) {
      await this.deps.volumeSamples.save({ space, measuredAt: at });
    }
    for (const user of await this.deps.repo.listAll()) {
      const used = await this.deps.quota.getUsage(user.username).catch(() => undefined);
      if (used === undefined) {
        continue;
      }
      await this.deps.samples.save({ username: user.username, used, sampledAt: at });
      await this.deps.gauges.show(user.username, used, user.quota);
      // what a member can clean is read once their usage is written down, and
      // a failure there costs neither that sample nor the next member's
      const attempt: SnapshotAttempt = await this.deps.cleanupSnapshot
        .execute(user.username, at)
        .catch((error: unknown) => ({ kind: 'failed' as const, error: messageOf(error) }));
      const stale = staleness(attempt);
      if (stale !== undefined) {
        staleSnapshots.push({ username: user.username, ...stale });
      }
      // watched once both are written down, from the usage just measured and
      // whatever list the member has; a failure costs no other member theirs
      await this.deps.spaceWatch.execute({ user, used }, at).catch((error: unknown) => {
        unwatched.push({ username: user.username, error: messageOf(error) });
      });
    }
    return { staleSnapshots, unwatched };
  }
}
