import type { TorrentMetainfo, TorrentMetainfoPort } from '../../../domain/torrent/ports.js';

export class FakeTorrentMetainfo implements TorrentMetainfoPort {
  private readonly byPath = new Map<string, TorrentMetainfo>();

  preload(path: string, metainfo: TorrentMetainfo): void {
    this.byPath.set(path, metainfo);
  }

  read(path: string): Promise<TorrentMetainfo | undefined> {
    return Promise.resolve(this.byPath.get(path));
  }
}
