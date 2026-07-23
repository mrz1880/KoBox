import type { Job } from './contract.js';

export interface ClaimedJob {
  readonly id: number;
  readonly job: Job;
}

export interface JobQueuePort {
  enqueue(job: Job): Promise<number>;
  claimNextPending(): Promise<ClaimedJob | undefined>;
  markDone(id: number): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
}
