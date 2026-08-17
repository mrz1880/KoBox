import type { SshKeyRepository, StoredSshKey } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemorySshKeyRepository implements SshKeyRepository {
  private readonly rows = new Map<string, StoredSshKey>();

  find(username: Username): Promise<StoredSshKey | undefined> {
    return Promise.resolve(this.rows.get(username.value));
  }

  save(stored: StoredSshKey): Promise<void> {
    this.rows.set(stored.username.value, stored);
    return Promise.resolve();
  }

  remove(username: Username): Promise<void> {
    this.rows.delete(username.value);
    return Promise.resolve();
  }
}
