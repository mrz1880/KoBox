import { SyncTransfer, type TransferState } from '../../domain/sync/SyncTransfer.js';
import type { SyncTransferRepository } from '../../domain/sync/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemorySyncTransferRepository implements SyncTransferRepository {
  private readonly rows = new Map<number, SyncTransfer>();
  private nextId = 1;

  queue(transfer: SyncTransfer): Promise<SyncTransfer | undefined> {
    const duplicate = [...this.rows.values()].some(
      (row) =>
        row.username.value === transfer.username.value &&
        row.source.equals(transfer.source),
    );
    if (duplicate) {
      return Promise.resolve(undefined);
    }
    const id = this.nextId++;
    const stored = SyncTransfer.restore({
      id,
      username: transfer.username,
      label: transfer.label,
      source: transfer.source,
      state: transfer.state,
      attempts: transfer.attempts,
      ...(transfer.lastError !== undefined && { lastError: transfer.lastError }),
      queuedAt: transfer.queuedAt,
      updatedAt: transfer.updatedAt,
    });
    this.rows.set(id, stored);
    return Promise.resolve(stored);
  }

  save(transfer: SyncTransfer): Promise<void> {
    if (transfer.id === undefined) {
      return Promise.reject(new Error('a transfer must be queued before it can be saved'));
    }
    this.rows.set(transfer.id, transfer);
    return Promise.resolve();
  }

  findById(id: number): Promise<SyncTransfer | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  listWaiting(username: Username, limit?: number): Promise<readonly SyncTransfer[]> {
    const waiting = this.ordered().filter(
      (row) => row.username.value === username.value && row.state === 'waiting',
    );
    return Promise.resolve(limit === undefined ? waiting : waiting.slice(0, limit));
  }

  listRecent(username: Username, limit: number): Promise<readonly SyncTransfer[]> {
    return Promise.resolve(
      this.ordered()
        .filter((row) => row.username.value === username.value)
        .reverse()
        .slice(0, limit),
    );
  }

  countByState(username: Username, state: TransferState): Promise<number> {
    return Promise.resolve(
      this.ordered().filter(
        (row) => row.username.value === username.value && row.state === state,
      ).length,
    );
  }

  private ordered(): SyncTransfer[] {
    return [...this.rows.entries()].sort(([left], [right]) => left - right).map(([, row]) => row);
  }
}
