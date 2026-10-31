import { describe, expect, it } from 'vitest';
import { AwaitJob } from '../../../../src/application/jobs/AwaitJob.js';
import type { JobProgressPort, JobState } from '../../../../src/application/jobs/JobProgressPort.js';

// a job that moves to a new state each time the clock reaches the next step
function progressOf(timeline: readonly (readonly [number, JobState])[], clock: { ms: number }): JobProgressPort {
  return {
    stateOf: () => {
      const reached = timeline.filter(([at]) => at <= clock.ms);
      return Promise.resolve(reached[reached.length - 1]?.[1]);
    },
  };
}

function waiting(timeline: readonly (readonly [number, JobState])[]): AwaitJob {
  const clock = { ms: 0 };
  return new AwaitJob({
    progress: progressOf(timeline, clock),
    pause: (ms) => {
      clock.ms += ms;
      return Promise.resolve();
    },
    patienceMs: 3000,
    everyMs: 250,
  });
}

describe('AwaitJob', () => {
  // the worker looks for work every second: most changes land well within
  // the wait, and the page then shows them at once
  it('should_report_a_job_the_worker_finished_within_the_wait_as_done', async () => {
    const job = waiting([[0, 'pending'], [1000, 'running'], [1250, 'done']]);

    expect(await job.execute(7)).toBe('done');
  });

  // an upgrade or a backup outlasts any wait worth making someone sit through
  it('should_report_a_job_still_running_when_the_patience_runs_out', async () => {
    const job = waiting([[0, 'pending'], [1000, 'running'], [60_000, 'done']]);

    expect(await job.execute(7)).toBe('running');
  });

  it('should_report_a_failed_job_as_soon_as_the_worker_gives_up', async () => {
    const job = waiting([[0, 'pending'], [1000, 'failed']]);

    expect(await job.execute(7)).toBe('failed');
  });
});
