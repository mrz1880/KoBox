import type { DebridAccountRepository } from '../../domain/ddl/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Row {
  readonly encryptedKey: string;
  readonly updatedAt: string;
}

export class InMemoryDebridAccountRepository implements DebridAccountRepository {
  private readonly rows = new Map<string, Row>();

  save(username: Username, encryptedKey: string, now: string): Promise<void> {
    this.rows.set(username.value, { encryptedKey, updatedAt: now });
    return Promise.resolve();
  }

  findEncrypted(username: Username): Promise<string | undefined> {
    return Promise.resolve(this.rows.get(username.value)?.encryptedKey);
  }

  remove(username: Username): Promise<void> {
    this.rows.delete(username.value);
    return Promise.resolve();
  }

  has(username: Username): Promise<boolean> {
    return Promise.resolve(this.rows.has(username.value));
  }
}
