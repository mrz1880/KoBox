import type { Job } from '../../application/jobs/contract.js';
import { InMemoryJobQueue } from '../../infrastructure/persistence/InMemoryJobQueue.js';
import { JobWorker, type JobWorkerDeps } from './JobWorker.js';

export type DirectJobRunnerDeps = Omit<JobWorkerDeps, 'queue'>;

// What `kobox --direct` runs: the job and everything the worker would chain
// after it, here and now. It is the worker itself over a queue of its own, so
// "what follows job X" keeps one definition, followUpsOf, which the worker
// consults after every job, and the dedupe stays the queue's.
export class DirectJobRunner {
  constructor(private readonly deps: DirectJobRunnerDeps) {}

  async run(job: Job): Promise<void> {
    const queue = new InMemoryJobQueue();
    await queue.enqueue(job);
    await new JobWorker({ ...this.deps, queue }).drain();
    const failures = queue.failures();
    if (failures.length > 0) {
      throw new Error(
        failures.map(({ job: failed, error }) => `${failed.type}: ${error}`).join('\n'),
      );
    }
  }
}
