import type { TorrentFilingPort } from '../../../domain/torrent/ports.js';

export class FakeTorrentFiling implements TorrentFilingPort {
  readonly filed: { file: string; folder: string }[] = [];

  file(torrentFile: string, folder: string): Promise<void> {
    this.filed.push({ file: torrentFile, folder });
    return Promise.resolve();
  }
}
