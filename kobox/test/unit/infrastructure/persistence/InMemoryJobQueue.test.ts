import { describe, expect, it } from 'vitest';
import { parseJob } from '../../../../src/application/jobs/contract.js';
import { InMemoryJobQueue } from '../../../../src/infrastructure/persistence/InMemoryJobQueue.js';

const suspendAlice = parseJob('suspend-user', { username: 'alice' });
const resumeAlice = parseJob('resume-user', { username: 'alice' });
const renderWhitelist = parseJob('render-whitelist', {});

describe('the in-memory job queue', () => {
  it('should_tell_where_a_job_stands_as_the_worker_moves_it_along', async () => {
    const queue = new InMemoryJobQueue();
    const id = await queue.enqueue(suspendAlice);
    const states = [await queue.stateOf(id)];
    await queue.claimNextPending();
    states.push(await queue.stateOf(id));
    await queue.markDone(id);
    states.push(await queue.stateOf(id));

    expect(states).toEqual(['pending', 'running', 'done']);
    expect(await queue.stateOf(id + 1)).toBeUndefined();
  });

  it('should_list_the_jobs_still_waiting_in_the_order_they_were_queued', async () => {
    const queue = new InMemoryJobQueue();
    await queue.enqueue(suspendAlice);
    await queue.enqueue(resumeAlice);
    await queue.enqueue(renderWhitelist);
    await queue.claimNextPending();

    expect(queue.pending()).toEqual([resumeAlice, renderWhitelist]);
  });

  it('should_name_each_failed_job_by_its_id_with_the_error_it_stored', async () => {
    const queue = new InMemoryJobQueue();
    await queue.enqueue(suspendAlice);
    const id = await queue.enqueue(resumeAlice);
    await queue.claimNextPending();
    await queue.claimNextPending();
    await queue.markFailed(id, 'alice not found');

    expect(queue.failures()).toEqual([{ id, job: resumeAlice, error: 'alice not found' }]);
  });
});
