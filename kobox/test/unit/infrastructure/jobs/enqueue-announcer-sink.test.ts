import { describe, expect, it } from 'vitest';
import type { Job } from '../../../../src/application/jobs/contract.js';
import { Announcer } from '../../../../src/domain/torrent/Announcer.js';
import { EnqueueAnnouncerSink } from '../../../../src/infrastructure/jobs/EnqueueAnnouncerSink.js';

function queueRecorder() {
  const jobs: Job[] = [];
  return {
    jobs,
    queue: {
      enqueue: (job: Job) => {
        jobs.push(job);
        return Promise.resolve(jobs.length);
      },
      claimNextPending: () => Promise.resolve(undefined),
      markDone: () => Promise.resolve(),
      markFailed: () => Promise.resolve(),
      recoverStale: () => Promise.resolve(0),
    },
  };
}

describe('EnqueueAnnouncerSink', () => {
  it('should_enqueue_one_discovery_per_unique_host', async () => {
    const { jobs, queue } = queueRecorder();
    const sink = new EnqueueAnnouncerSink(queue);

    await sink.publish(
      [
        Announcer.parse('https://tracker.example.org/announce'),
        Announcer.parse('https://tracker.example.org:2710/backup'),
        Announcer.parse('udp://udp.example.io/announce'),
      ],
      'private',
    );

    expect(jobs.map((job) => job.type)).toEqual(['discover-tracker', 'discover-tracker']);
  });

  it('should_isolate_an_announcer_the_wire_contract_rejects', async () => {
    const { jobs, queue } = queueRecorder();
    const sink = new EnqueueAnnouncerSink(queue);

    // 'localhost' parses as an Announcer but the job contract requires a
    // FQDN (>= 2 labels): the bad one must be skipped, not abort the rest
    await sink.publish(
      [
        Announcer.parse('http://localhost/announce'),
        Announcer.parse('https://tracker.example.org/announce'),
      ],
      'private',
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.type).toBe('discover-tracker');
  });
});
