import type {
  ReleaseRecord,
  ReleaseRepositoryPort,
  ReleaseState,
} from '../../application/maintenance/ReleaseRepositoryPort.js';

export class InMemoryReleaseRepository implements ReleaseRepositoryPort {
  private readonly rows: ReleaseRecord[] = [];
  private nextId = 1;

  record(ref: string, path: string, now: string): Promise<number> {
    const id = this.nextId++;
    this.rows.push({ id, ref, path, state: 'staged', createdAt: now });
    return Promise.resolve(id);
  }

  setState(id: number, state: ReleaseState, now: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) {
      const existing = this.rows[index];
      if (existing !== undefined) {
        this.rows[index] = { ...existing, state, switchedAt: now };
      }
    }
    return Promise.resolve();
  }

  findByState(state: ReleaseState): Promise<ReleaseRecord | undefined> {
    return Promise.resolve([...this.rows].reverse().find((row) => row.state === state));
  }

  list(): Promise<readonly ReleaseRecord[]> {
    return Promise.resolve([...this.rows].sort((a, b) => b.id - a.id));
  }
}
