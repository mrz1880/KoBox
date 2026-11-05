import type { Job } from '../../application/jobs/contract.js';
import type { JobProgressPort, JobState } from '../../application/jobs/JobProgressPort.js';
import type { ClaimedJob, JobQueuePort } from '../../application/jobs/JobQueuePort.js';

interface QueuedJob {
  readonly id: number;
  readonly job: Job;
  status: JobState;
  error?: string;
}

export interface FailedJob {
  readonly id: number;
  readonly job: Job;
  readonly error: string;
}

// A queue that lives as long as the process: what `kobox --direct` drains on
// the spot, so the jobs the worker would chain run in-process instead.
export class InMemoryJobQueue implements JobQueuePort, JobProgressPort {
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

  stateOf(id: number): Promise<JobState | undefined> {
    return Promise.resolve(this.rows.find((row) => row.id === id)?.status);
  }

  recoverStale(): Promise<number> {
    const stale = this.rows.filter((row) => row.status === 'running');
    for (const row of stale) {
      row.status = 'failed';
      row.error = 'interrupted: worker restarted';
    }
    return Promise.resolve(stale.length);
  }

  // what still waits for a worker, in the order the jobs were enqueued
  pending(): readonly Job[] {
    return this.rows.flatMap((row) => (row.status === 'pending' ? [row.job] : []));
  }

  // what was marked failed, in the order the jobs were enqueued
  failures(): readonly FailedJob[] {
    return this.rows.flatMap((row) =>
      row.status === 'failed' ? [{ id: row.id, job: row.job, error: row.error ?? '' }] : [],
    );
  }

  private settle(id: number, status: JobState, error?: string): void {
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
