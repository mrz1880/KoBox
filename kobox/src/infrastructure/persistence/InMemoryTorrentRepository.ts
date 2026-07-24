import type { InfoHash } from '../../domain/torrent/InfoHash.js';
import type { Torrent } from '../../domain/torrent/Torrent.js';
import type { TorrentRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';

function keyOf(username: Username, infoHash: InfoHash): string {
  return `${username.value}:${infoHash.value}`;
}

export class InMemoryTorrentRepository implements TorrentRepository {
  private readonly byKey = new Map<string, Torrent>();

  findByInfoHash(username: Username, infoHash: InfoHash): Promise<Torrent | undefined> {
    return Promise.resolve(this.byKey.get(keyOf(username, infoHash)));
  }

  upsert(username: Username, torrent: Torrent): Promise<void> {
    this.byKey.set(keyOf(username, torrent.infoHash), torrent);
    return Promise.resolve();
  }

  delete(username: Username, infoHash: InfoHash): Promise<void> {
    this.byKey.delete(keyOf(username, infoHash));
    return Promise.resolve();
  }

  listFor(username: Username): Promise<readonly Torrent[]> {
    return Promise.resolve(
      [...this.byKey.entries()]
        .filter(([key]) => key.startsWith(`${username.value}:`))
        .map(([, torrent]) => torrent),
    );
  }

  deleteAllFor(username: Username): Promise<void> {
    for (const key of [...this.byKey.keys()]) {
      if (key.startsWith(`${username.value}:`)) {
        this.byKey.delete(key);
      }
    }
    return Promise.resolve();
  }
}
