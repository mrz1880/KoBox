import type { InfoHash } from '../../domain/torrent/InfoHash.js';
import type { StalledHashCheckRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryStalledHashCheckRepository implements StalledHashCheckRepository {
  private readonly stalled = new Map<string, readonly InfoHash[]>();

  find(username: Username): Promise<readonly InfoHash[]> {
    return Promise.resolve(this.stalled.get(username.value) ?? []);
  }

  replace(username: Username, stalled: readonly InfoHash[]): Promise<void> {
    this.stalled.set(username.value, [...stalled]);
    return Promise.resolve();
  }
}
