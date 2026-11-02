import { CleanupCandidate } from '../../domain/space/CleanupCandidate.js';
import type { FinishedTorrent } from '../../domain/space/FinishedTorrent.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { instantOf } from '../../domain/shared/stamp.js';
import { LocalPath } from '../../domain/sync/LocalPath.js';
import type { SyncTransferRepository } from '../../domain/sync/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { seedRuleFor, type SeedRuleForDeps } from './seedRuleFor.js';

export interface CleanupJudgeDeps extends SeedRuleForDeps {
  readonly transfers: Pick<SyncTransferRepository, 'listSentSources' | 'listUnsettledSources'>;
}

// A sync source went through LocalPath, rTorrent's d.base_path did not: the
// torrent's path takes the same form before the two are compared. A path that
// is not a LocalPath (relative, climbing out with .., or holding a NUL) could
// not have been sent, and stays as it was.
function inSourceForm(torrent: FinishedTorrent): FinishedTorrent {
  try {
    return { ...torrent, path: LocalPath.parse(torrent.path).value };
  } catch (error) {
    if (error instanceof DomainError) {
      return torrent;
    }
    throw error;
  }
}

function pathsOf(sources: readonly LocalPath[]): ReadonlySet<string> {
  return new Set(sources.map((source) => source.value));
}

// Judges a member's torrents at one moment: the rule they answer to, what
// KoBox sync already put on the member's machine and what it has not yet are
// read once, then every torrent is judged against them. The snapshot and the
// cleanup judge the same way.
export class CleanupJudge {
  private constructor(
    private readonly context: Parameters<typeof CleanupCandidate.judge>[1],
  ) {}

  // `at` is the worker's stamp; the rule compares instants.
  static async of(deps: CleanupJudgeDeps, username: Username, at: string): Promise<CleanupJudge> {
    const [sent, unsettled] = await Promise.all([
      deps.transfers.listSentSources(username),
      deps.transfers.listUnsettledSources(username),
    ]);
    return new CleanupJudge({
      rule: await seedRuleFor(deps, username),
      sentPaths: pathsOf(sent),
      unsettledPaths: pathsOf(unsettled),
      now: instantOf(at),
    });
  }

  judge(torrent: FinishedTorrent): CleanupCandidate | undefined {
    return CleanupCandidate.judge(inSourceForm(torrent), this.context);
  }
}
