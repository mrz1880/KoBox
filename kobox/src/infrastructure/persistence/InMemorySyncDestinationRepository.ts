import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import type { SyncDestinationRepository } from '../../domain/sync/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemorySyncDestinationRepository implements SyncDestinationRepository {
  private readonly byUsername = new Map<string, SyncDestination>();

  findByUsername(username: Username): Promise<SyncDestination | undefined> {
    return Promise.resolve(this.byUsername.get(username.value));
  }

  save(destination: SyncDestination): Promise<void> {
    this.byUsername.set(destination.username.value, destination);
    return Promise.resolve();
  }

  delete(username: Username): Promise<void> {
    this.byUsername.delete(username.value);
    return Promise.resolve();
  }
}
