import { CleanupCandidate } from '../../domain/space/CleanupCandidate.js';
import type {
  CleanupSnapshotRepository,
  MemberTorrentsPort,
  SeedRuleRepository,
} from '../../domain/space/ports.js';
import type { FinishedTorrent } from '../../domain/space/FinishedTorrent.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import { LocalPath } from '../../domain/sync/LocalPath.js';
import type { SyncTransferRepository } from '../../domain/sync/ports.js';
import { instantOf } from '../../domain/shared/stamp.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly instances: TorrentInstanceRepository;
  readonly torrents: MemberTorrentsPort;
  readonly transfers: Pick<SyncTransferRepository, 'listSentSources'>;
  readonly seedRule: SeedRuleRepository;
  readonly snapshots: CleanupSnapshotRepository;
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

// Writes down what a member could clean, as root, because the portal cannot
// ask another account's rTorrent. A member without an rTorrent, or whose
// rTorrent does not answer, keeps the snapshot they had.
export class TakeCleanupSnapshot {
  constructor(private readonly deps: Deps) {}

  async execute(username: Username, at: string): Promise<void> {
    const instance = await this.deps.instances.findByUsername(username);
    if (instance === undefined) {
      return;
    }
    // an rTorrent that does not answer leaves the previous snapshot, whose
    // date tells the member how old it is
    const finished = await this.deps.torrents
      .listFinished(instance.scgiPort)
      .catch(() => undefined);
    if (finished === undefined) {
      return;
    }
    const context = {
      rule: await this.deps.seedRule.get(),
      sentPaths: new Set(
        (await this.deps.transfers.listSentSources(username)).map((source) => source.value),
      ),
      now: instantOf(at),
    };
    const candidates = finished.flatMap(
      (torrent) => CleanupCandidate.judge(inSourceForm(torrent), context) ?? [],
    );
    await this.deps.snapshots.replace(username, candidates, at);
  }
}
