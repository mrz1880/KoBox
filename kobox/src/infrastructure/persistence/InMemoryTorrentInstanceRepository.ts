import type { TorrentInstance } from '../../domain/torrent/TorrentInstance.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryTorrentInstanceRepository implements TorrentInstanceRepository {
  private readonly byUsername = new Map<string, TorrentInstance>();

  findByUsername(username: Username): Promise<TorrentInstance | undefined> {
    return Promise.resolve(this.byUsername.get(username.value));
  }

  save(instance: TorrentInstance): Promise<void> {
    this.byUsername.set(instance.username.value, instance);
    return Promise.resolve();
  }

  delete(username: Username): Promise<void> {
    this.byUsername.delete(username.value);
    return Promise.resolve();
  }
}
