import { parseJob } from '../../application/jobs/contract.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import type { Announcer } from '../../domain/torrent/Announcer.js';
import type { AnnouncerSink } from '../../domain/torrent/ports.js';

// The concrete seam: one discover-tracker job per unique announcer host.
// Dedupe within the publication (multi-tier announce lists repeat hosts).
export class EnqueueAnnouncerSink implements AnnouncerSink {
  constructor(private readonly queue: JobQueuePort) {}

  async publish(
    announcers: readonly Announcer[],
    privacy: 'public' | 'private',
  ): Promise<void> {
    const seen = new Set<string>();
    for (const announcer of announcers) {
      if (seen.has(announcer.host)) {
        continue;
      }
      seen.add(announcer.host);
      await this.queue.enqueue(parseJob('discover-tracker', { url: announcer.url, privacy }));
    }
  }
}
