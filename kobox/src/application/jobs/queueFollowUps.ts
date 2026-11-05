import type { FollowUp } from './FollowUps.js';
import type { JobQueuePort } from './JobQueuePort.js';

/**
 * Puts follow-ups into the queue, in order: one that joins goes in only when
 * the same job is not already waiting, one that queues another always does.
 * What follows which job is the follow-up policy's; this is how it enters.
 *
 * @param queue where the follow-ups wait for the worker
 * @param followUps what the policy decided, in the order to queue it
 */
export async function queueFollowUps(
  queue: JobQueuePort,
  followUps: readonly FollowUp[],
): Promise<void> {
  for (const followUp of followUps) {
    switch (followUp.ifAlreadyPending) {
      case 'join':
        await queue.enqueueUnique(followUp.job);
        break;
      case 'queue-another':
        await queue.enqueue(followUp.job);
        break;
    }
  }
}
