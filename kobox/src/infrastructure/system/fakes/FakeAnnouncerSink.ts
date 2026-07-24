import type { Announcer } from '../../../domain/torrent/Announcer.js';
import type { AnnouncerSink } from '../../../domain/torrent/ports.js';

export interface RecordedPublication {
  readonly urls: readonly string[];
  readonly privacy: 'public' | 'private';
}

export class FakeAnnouncerSink implements AnnouncerSink {
  readonly publications: RecordedPublication[] = [];

  publish(announcers: readonly Announcer[], privacy: 'public' | 'private'): Promise<void> {
    this.publications.push({ urls: announcers.map((announcer) => announcer.url), privacy });
    return Promise.resolve();
  }
}
