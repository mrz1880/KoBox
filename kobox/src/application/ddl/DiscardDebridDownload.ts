import type {
  DebridDownloadRepository,
  DownloadPlacementPort,
  DownloaderPort,
} from '../../domain/ddl/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly repo: DebridDownloadRepository;
  readonly downloader: DownloaderPort;
  readonly placement: DownloadPlacementPort;
}

// A member tidying their own list. Removing the row alone left aria2 still
// holding the download and its partial bytes on disk, with nothing left to
// reference them: they would never have been cleaned up.
//
// Order matters. aria2 is asked first, because it is the only thing that knows
// which file it was writing; the row goes last, so a failure anywhere leaves a
// line the member can try again rather than an orphan nobody can reach.
export class DiscardDebridDownload {
  constructor(private readonly deps: Deps) {}

  async execute(command: { username: Username; id: number }): Promise<void> {
    const found = await this.deps.repo.findById(command.id);
    // ownership before anything else: an id is guessable
    if (found?.username.equals(command.username) !== true) {
      return;
    }
    if (found.gid !== undefined) {
      const { stagedPath } = await this.deps.downloader.cancel(found.gid);
      // only what aria2 was still holding, which is inside the staging dir. A
      // placed file belongs to the member and is never touched by this.
      if (stagedPath !== undefined) {
        await this.deps.placement.discardStaged(stagedPath);
      }
    }
    await this.deps.repo.removeForUser(command.username, command.id);
  }
}
