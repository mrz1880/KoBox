import { CleanupCandidate } from '../../domain/space/CleanupCandidate.js';
import type { FinishedTorrent } from '../../domain/space/FinishedTorrent.js';
import type { SeedRuleRepository } from '../../domain/space/ports.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { instantOf } from '../../domain/shared/stamp.js';
import { LocalPath } from '../../domain/sync/LocalPath.js';
import type { SyncTransferRepository } from '../../domain/sync/ports.js';
import type { Username } from '../../domain/user/Username.js';

export interface CleanupJudgeDeps {
  readonly transfers: Pick<SyncTransferRepository, 'listSentSources'>;
  readonly seedRule: SeedRuleRepository;
}

// A sync source went through LocalPath, rTorrent's d.base_path did not: the
// torrent's path takes the same form before the two are compared. A path that
// is not a LocalPath (empty while rTorrent has the torrent closed) could not
// have been sent, and stays as it was.
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

// Judges a member's torrents at one moment: the box's rule and what KoBox sync
// already put on the member's machine are read once, then every torrent is
// judged against them. The snapshot and the cleanup judge the same way.
export class CleanupJudge {
  private constructor(
    private readonly context: Parameters<typeof CleanupCandidate.judge>[1],
  ) {}

  // `at` is the worker's stamp; the rule compares instants.
  static async of(deps: CleanupJudgeDeps, username: Username, at: string): Promise<CleanupJudge> {
    const sources = await deps.transfers.listSentSources(username);
    return new CleanupJudge({
      rule: await deps.seedRule.get(),
      sentPaths: new Set(sources.map((source) => source.value)),
      now: instantOf(at),
    });
  }

  judge(torrent: FinishedTorrent): CleanupCandidate | undefined {
    return CleanupCandidate.judge(inSourceForm(torrent), this.context);
  }
}
