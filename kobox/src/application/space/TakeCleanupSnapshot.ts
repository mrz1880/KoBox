import type { FinishedTorrent } from '../../domain/space/FinishedTorrent.js';
import type { CleanupSnapshotRepository, MemberTorrentsPort } from '../../domain/space/ports.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { CleanupJudge, type CleanupJudgeDeps } from './CleanupJudge.js';

interface Deps extends CleanupJudgeDeps {
  readonly instances: TorrentInstanceRepository;
  readonly torrents: MemberTorrentsPort;
  readonly snapshots: CleanupSnapshotRepository;
}

// What became of a member's snapshot: an operator is told when an rTorrent
// that should have answered did not, the member only sees an older date.
export type CleanupSnapshotOutcome =
  | { readonly kind: 'taken' }
  | { readonly kind: 'noRtorrent' }
  | { readonly kind: 'rtorrentSilent'; readonly error: string };

// Writes down what a member could clean, as root, because the portal cannot
// ask another account's rTorrent. A member without an rTorrent, or whose
// rTorrent does not answer, keeps the snapshot they had.
export class TakeCleanupSnapshot {
  constructor(private readonly deps: Deps) {}

  async execute(username: Username, at: string): Promise<CleanupSnapshotOutcome> {
    const instance = await this.deps.instances.findByUsername(username);
    if (instance === undefined) {
      return { kind: 'noRtorrent' };
    }
    // an rTorrent that does not answer leaves the previous snapshot, whose
    // date tells the member how old it is
    let finished: readonly FinishedTorrent[];
    try {
      finished = await this.deps.torrents.listFinished(instance.scgiPort);
    } catch (error) {
      return {
        kind: 'rtorrentSilent',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const judge = await CleanupJudge.of(this.deps, username, at);
    const candidates = finished.flatMap((torrent) => judge.judge(torrent) ?? []);
    await this.deps.snapshots.replace(username, candidates, at);
    return { kind: 'taken' };
  }
}
