import { LocalPath } from '../../domain/sync/LocalPath.js';
import { SyncTransfer } from '../../domain/sync/SyncTransfer.js';
import type { SyncTransferRepository } from '../../domain/sync/ports.js';
import type { Label } from '../../domain/torrent/Label.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';

export interface QueueFinishedDownloadCommand {
  readonly username: Username;
  readonly label: Label;
  readonly source: string;
}

export interface QueueVerdict {
  readonly queued: boolean;
  // true when the member asked for this folder to go out straight away, rather
  // than waiting for their chosen hour
  readonly sendNow: boolean;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
  readonly transfers: SyncTransferRepository;
  readonly clock: () => string;
}

const NOTHING: QueueVerdict = { queued: false, sendNow: false };

// Called when a download finishes. Whether anything is queued at all is the
// category's decision, which its owner made on their own page.
export class QueueFinishedDownload {
  constructor(private readonly deps: Deps) {}

  async execute(command: QueueFinishedDownloadCommand): Promise<QueueVerdict> {
    const instance = await this.deps.instances.findByUsername(command.username);
    if (instance === undefined) {
      return NOTHING;
    }
    const category = instance.watchDirs.find(
      (dir) => dir.label?.equals(command.label) === true,
    );
    if (!category?.syncMode.sends) {
      return NOTHING;
    }

    let source: LocalPath;
    try {
      source = LocalPath.parse(command.source);
    } catch {
      return NOTHING;
    }
    // Privilege seam, again: the path arrives from a shim a member controls, and
    // the root worker will read it. Anything outside their own home is ignored
    // — never read, never queued, never sent to somebody else's machine.
    if (!source.isInside(`/home/${command.username.value}`)) {
      return NOTHING;
    }

    const queued = await this.deps.transfers.queue(
      SyncTransfer.queue({
        username: command.username,
        label: command.label,
        source,
        queuedAt: this.deps.clock(),
      }),
    );
    // already queued: rTorrent can fire `finished` more than once for one
    // torrent, and the legacy stacked a duplicate every time it did
    if (queued === undefined) {
      return NOTHING;
    }
    return { queued: true, sendNow: category.syncMode.isImmediate };
  }
}
