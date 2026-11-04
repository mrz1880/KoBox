import type { Job } from '../../application/jobs/contract.js';
import type { ClaimedJob, JobQueuePort } from '../../application/jobs/JobQueuePort.js';

type JobStatus = 'pending' | 'running' | 'done' | 'failed';

interface QueuedJob {
  readonly id: number;
  readonly job: Job;
  status: JobStatus;
  error?: string;
}

export interface FailedJob {
  readonly job: Job;
  readonly error: string;
}

// A queue that lives as long as the process: what `kobox --direct` drains on
// the spot, so the jobs the worker would chain run in-process instead.
export class InMemoryJobQueue implements JobQueuePort {
  private readonly rows: QueuedJob[] = [];
  private nextId = 1;

  enqueue(job: Job): Promise<number> {
    const id = this.nextId++;
    this.rows.push({ id, job, status: 'pending' });
    return Promise.resolve(id);
  }

  enqueueUnique(job: Job): Promise<number | undefined> {
    const payloadJson = JSON.stringify(job.payload);
    const pending = this.rows.some(
      (row) =>
        row.status === 'pending' &&
        row.job.type === job.type &&
        JSON.stringify(row.job.payload) === payloadJson,
    );
    return pending ? Promise.resolve(undefined) : this.enqueue(job);
  }

  claimNextPending(): Promise<ClaimedJob | undefined> {
    const row = this.rows.find((candidate) => candidate.status === 'pending');
    if (row === undefined) {
      return Promise.resolve(undefined);
    }
    row.status = 'running';
    return Promise.resolve({ id: row.id, job: row.job });
  }

  markDone(id: number): Promise<void> {
    this.settle(id, 'done');
    return Promise.resolve();
  }

  markFailed(id: number, error: string): Promise<void> {
    this.settle(id, 'failed', error);
    return Promise.resolve();
  }

  recoverStale(): Promise<number> {
    const stale = this.rows.filter((row) => row.status === 'running');
    for (const row of stale) {
      row.status = 'failed';
      row.error = 'interrupted: worker restarted';
    }
    return Promise.resolve(stale.length);
  }

  // what was marked failed, in the order the jobs were enqueued
  failures(): readonly FailedJob[] {
    return this.rows.flatMap((row) =>
      row.status === 'failed' ? [{ job: row.job, error: row.error ?? '' }] : [],
    );
  }

  private settle(id: number, status: JobStatus, error?: string): void {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row === undefined) {
      return;
    }
    row.status = status;
    if (error !== undefined) {
      row.error = error;
    }
  }
}
