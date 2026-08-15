import type { SyncTransferRepository } from '../../domain/sync/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly transfers: SyncTransferRepository;
  readonly clock: () => string;
}

// "Put it back in the queue" — the legacy had the same control at the bottom of
// its screen, and it is the difference between a failure a member can fix and
// one that costs them the download again.
export class RequeueTransfer {
  constructor(private readonly deps: Deps) {}

  async execute(username: Username, id: number): Promise<void> {
    const transfer = await this.deps.transfers.findById(id);
    // ownership is checked here, not in the route: a member may only ever put
    // their own transfer back, and the id came from a form
    if (transfer?.username.value !== username.value) {
      return;
    }
    await this.deps.transfers.save(transfer.requeue(this.deps.clock()));
  }
}
