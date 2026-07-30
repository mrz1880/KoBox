import { basename } from 'node:path';
import type {
  DebridDownloadRepository,
  DownloaderPort,
  DownloadPlacementPort,
} from '../../domain/ddl/ports.js';

interface Deps {
  readonly repo: DebridDownloadRepository;
  readonly downloader: DownloaderPort;
  readonly placement: DownloadPlacementPort;
}

// The scheduled step: advance every active download. Complete -> place the file
// into the user home and mark done; error -> fail the row; still running ->
// leave it. Idempotent (only 'downloading' rows are in the work-list).
export class PollDebridDownloads {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    for (const download of await this.deps.repo.listActive()) {
      if (download.gid === undefined) {
        continue;
      }
      const state = await this.deps.downloader.status(download.gid);
      if (state.state === 'complete' && state.filePath !== undefined) {
        const finalPath = await this.deps.placement.place(
          state.filePath,
          download.username,
          download.category,
        );
        await this.deps.repo.save(download.completed(basename(finalPath)));
      } else if (state.state === 'error') {
        await this.deps.repo.save(download.failed(state.message ?? 'download failed'));
      }
    }
  }
}
