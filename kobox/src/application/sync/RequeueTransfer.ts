import { departureOf, type Departure } from '../../domain/sync/Departure.js';
import type { SyncTransferRepository } from '../../domain/sync/ports.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';

// What became of the request: when the transfer now leaves, or that there was
// no transfer of this member's to put back.
export type RequeueOutcome = Departure | 'not-requeued';

interface Deps {
  readonly transfers: SyncTransferRepository;
  // the folders and how each one sends: they decide when a transfer leaves
  readonly instances: TorrentInstanceRepository;
  readonly clock: () => string;
}

// "Put it back in the queue": the legacy had the same control at the bottom of
// its screen, and it is the difference between a failure a member can fix and
// one that costs them the download again.
export class RequeueTransfer {
  constructor(private readonly deps: Deps) {}

  async execute(username: Username, id: number): Promise<RequeueOutcome> {
    const transfer = await this.deps.transfers.findById(id);
    // ownership is checked here, not in the route: a member may only ever put
    // their own transfer back, and the id came from a form
    if (transfer?.username.value !== username.value) {
      return 'not-requeued';
    }
    await this.deps.transfers.save(transfer.requeue(this.deps.clock()));
    return departureOf(
      await this.deps.instances.findByUsername(username),
      transfer.label,
    );
  }
}
