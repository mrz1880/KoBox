import { join } from 'node:path';
import type { DebridDownloadRepository, DebridPort, DownloaderPort } from '../../domain/ddl/ports.js';
import { DebridDownloadNotFoundError } from './errors.js';

export interface StartDebridDownloadCommand {
  readonly downloadId: number;
}

interface Deps {
  readonly repo: DebridDownloadRepository;
  readonly debrid: DebridPort;
  readonly downloader: DownloaderPort;
  readonly stagingBase: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The worker step: unlock the link (debrid), hand the direct URL to aria2 in a
// per-user staging dir, and record the gid. A resolve/add failure fails the row
// (visible to the user) instead of throwing the job. Idempotent: a row already
// past pending is skipped.
export class StartDebridDownload {
  constructor(private readonly deps: Deps) {}

  async execute(command: StartDebridDownloadCommand): Promise<void> {
    const download = await this.deps.repo.findById(command.downloadId);
    if (download === undefined) {
      throw new DebridDownloadNotFoundError(command.downloadId);
    }
    if (download.status !== 'pending') {
      return;
    }
    try {
      const { direct } = await this.deps.debrid.unlock(download.sourceLink);
      const dir = join(this.deps.stagingBase, download.username.value);
      const gid = await this.deps.downloader.addUri(direct, dir);
      await this.deps.repo.save(download.startedWith(gid));
    } catch (error) {
      await this.deps.repo.save(download.failed(messageOf(error)));
    }
  }
}
