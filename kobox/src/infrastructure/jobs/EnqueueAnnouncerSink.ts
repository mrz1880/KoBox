import { parseJob } from '../../application/jobs/contract.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import type { Announcer } from '../../domain/torrent/Announcer.js';
import type { AnnouncerSink } from '../../domain/torrent/ports.js';

function isTrackerHost(host: string): boolean {
  try {
    TrackerHost.parse(host);
    return true;
  } catch {
    return false; // single-label or malformed announcer host from a wild torrent
  }
}

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
      if (seen.has(announcer.host) || !isTrackerHost(announcer.host)) {
        continue;
      }
      seen.add(announcer.host);
      try {
        await this.queue.enqueue(parseJob('discover-tracker', { url: announcer.url, privacy }));
      } catch {
        // an announcer the wire contract rejects (oversized URL) must skip
        // that one entry, not abort the rest of the publication
      }
    }
  }
}
