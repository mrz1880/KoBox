import { DomainError } from '../../domain/shared/DomainError.js';
import { LocalPath } from '../../domain/sync/LocalPath.js';
import type { LocalFileFactsPort } from '../../domain/sync/ports.js';
import type { Label } from '../../domain/torrent/Label.js';
import type { TorrentRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { QueueFinishedDownload } from './QueueFinishedDownload.js';

export interface QueueFolderBacklogCommand {
  readonly username: Username;
  readonly label: Label;
}

export interface QueueFolderBacklogReport {
  readonly queued: number;
  // true when the folder goes out straight away rather than at the member's hour
  readonly sendNow: boolean;
}

interface Deps {
  readonly torrents: TorrentRepository;
  readonly files: LocalFileFactsPort;
  readonly queueFinished: QueueFinishedDownload;
}

// A folder only queues what finishes once it is set to send: what finished
// before stayed on the box. Asked for, this queues those too, each as if it had
// just finished, so the folder's mode, the home-only rule and the one-row-per-
// download rule all apply unchanged. What is gone from the disk is left out
// rather than queued to fail.
export class QueueFolderBacklog {
  constructor(private readonly deps: Deps) {}

  async execute(command: QueueFolderBacklogCommand): Promise<QueueFolderBacklogReport> {
    let queued = 0;
    let sendNow = false;
    for (const torrent of await this.deps.torrents.listFor(command.username)) {
      const tree = torrent.finishedTreeIn(command.label);
      if (tree === undefined || !(await this.stillThere(tree))) {
        continue;
      }
      const verdict = await this.deps.queueFinished.execute({
        username: command.username,
        label: command.label,
        source: tree,
      });
      if (verdict.queued) {
        queued += 1;
        sendNow = sendNow || verdict.sendNow;
      }
    }
    return { queued, sendNow };
  }

  private async stillThere(tree: string): Promise<boolean> {
    let path: LocalPath;
    try {
      path = LocalPath.parse(tree);
    } catch (error) {
      // a path that is not one cannot be sent either; the queue would refuse it
      if (error instanceof DomainError) {
        return false;
      }
      throw error;
    }
    return this.deps.files.exists(path);
  }
}
