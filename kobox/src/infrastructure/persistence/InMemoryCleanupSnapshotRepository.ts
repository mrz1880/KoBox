import type { CleanupCandidate } from '../../domain/space/CleanupCandidate.js';
import type { CleanupSnapshot, CleanupSnapshotRepository } from '../../domain/space/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryCleanupSnapshotRepository implements CleanupSnapshotRepository {
  private readonly snapshots = new Map<string, CleanupSnapshot>();

  replace(
    username: Username,
    candidates: readonly CleanupCandidate[],
    takenAt: string,
  ): Promise<void> {
    this.snapshots.set(username.value, { candidates: [...candidates], takenAt });
    return Promise.resolve();
  }

  find(username: Username): Promise<CleanupSnapshot | undefined> {
    return Promise.resolve(this.snapshots.get(username.value));
  }
}
