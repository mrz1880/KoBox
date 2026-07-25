export type ReleaseState = 'staged' | 'current' | 'previous' | 'failed';

export interface ReleaseRecord {
  readonly id: number;
  readonly ref: string;
  readonly path: string;
  readonly state: ReleaseState;
  readonly createdAt: string;
  readonly switchedAt?: string;
}

// The upgrade ledger (§5.6 anti-GitHubRepoUpdate): every staged release
// leaves a truthful row; `current`/`previous` drive symlink flips and
// rollback. The use case owns the state machine, this owns persistence.
export interface ReleaseRepositoryPort {
  record(ref: string, path: string, now: string): Promise<number>;
  setState(id: number, state: ReleaseState, now: string): Promise<void>;
  findByState(state: ReleaseState): Promise<ReleaseRecord | undefined>;
  list(): Promise<readonly ReleaseRecord[]>;
}
