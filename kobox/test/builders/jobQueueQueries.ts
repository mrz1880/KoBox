import type { JobType } from '../../src/application/jobs/contract.js';
import type { InMemoryJobQueue } from '../../src/infrastructure/persistence/InMemoryJobQueue.js';

// The types of the jobs still waiting, in the order they were queued: what a
// test reads to see what a job chained after itself.
export function pendingTypesOf(queue: InMemoryJobQueue): readonly JobType[] {
  return queue.pending().map((job) => job.type);
}

// The error a job stored when the worker marked it failed; undefined while it
// has not failed.
export function errorOf(queue: InMemoryJobQueue, id: number): string | undefined {
  return queue.failures().find((failure) => failure.id === id)?.error;
}
