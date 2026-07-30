import { eq } from 'drizzle-orm';
import type { DebridAccountRepository } from '../../domain/ddl/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { debridAccounts } from './schema.js';

// Holds only CIPHERTEXT: the portal shares this database, so what it can read it
// must not be able to use (the private half lives in a root-only PEM).
export class SqliteDebridAccountRepository implements DebridAccountRepository {
  constructor(private readonly db: KoboxDatabase) {}

  save(username: Username, encryptedKey: string, now: string): Promise<void> {
    this.db.orm
      .insert(debridAccounts)
      .values({ username: username.value, encryptedKey, updatedAt: now })
      // one key per user: a new one replaces the old instead of accumulating
      .onConflictDoUpdate({
        target: debridAccounts.username,
        set: { encryptedKey, updatedAt: now },
      })
      .run();
    return Promise.resolve();
  }

  findEncrypted(username: Username): Promise<string | undefined> {
    const row = this.db.orm
      .select()
      .from(debridAccounts)
      .where(eq(debridAccounts.username, username.value))
      .get();
    return Promise.resolve(row?.encryptedKey);
  }

  remove(username: Username): Promise<void> {
    this.db.orm.delete(debridAccounts).where(eq(debridAccounts.username, username.value)).run();
    return Promise.resolve();
  }

  async has(username: Username): Promise<boolean> {
    return (await this.findEncrypted(username)) !== undefined;
  }
}
