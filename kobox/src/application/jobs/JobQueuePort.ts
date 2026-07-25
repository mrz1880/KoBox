import type { Job } from './contract.js';

export interface ClaimedJob {
  readonly id: number;
  readonly job: Job;
}

export interface JobQueuePort {
  enqueue(job: Job): Promise<number>;
  // Scheduler entry point: skips the insert when an identical (type, payload)
  // job is already pending, so repeated ticks never grow a backlog while the
  // worker is down. Returns the new id, or undefined when deduped.
  enqueueUnique(job: Job): Promise<number | undefined>;
  claimNextPending(): Promise<ClaimedJob | undefined>;
  markDone(id: number): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
  // Startup sweep: jobs left 'running' by a crashed/stopped worker become
  // 'failed' (visible, re-enqueueable) instead of silently stuck forever.
  recoverStale(): Promise<number>;
}
