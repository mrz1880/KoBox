import { eq } from 'drizzle-orm';
import type { SshKeyRepository, StoredSshKey } from '../../domain/user/ports.js';
import { SshPublicKey } from '../../domain/user/SshPublicKey.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { sshKeys } from './schema.js';

export class SqliteSshKeyRepository implements SshKeyRepository {
  constructor(private readonly db: KoboxDatabase) {}

  find(username: Username): Promise<StoredSshKey | undefined> {
    const row = this.db.orm
      .select()
      .from(sshKeys)
      .where(eq(sshKeys.username, username.value))
      .get();
    return Promise.resolve(
      row === undefined
        ? undefined
        : {
            username: Username.parse(row.username),
            key: SshPublicKey.parse(row.key),
            addedAt: row.addedAt,
          },
    );
  }

  save(stored: StoredSshKey): Promise<void> {
    const values = {
      username: stored.username.value,
      key: `${stored.key.type} ${stored.key.body}${stored.key.comment === '' ? '' : ` ${stored.key.comment}`}`,
      addedAt: stored.addedAt,
    };
    this.db.orm
      .insert(sshKeys)
      .values(values)
      .onConflictDoUpdate({ target: sshKeys.username, set: values })
      .run();
    return Promise.resolve();
  }

  remove(username: Username): Promise<void> {
    this.db.orm.delete(sshKeys).where(eq(sshKeys.username, username.value)).run();
    return Promise.resolve();
  }
}
