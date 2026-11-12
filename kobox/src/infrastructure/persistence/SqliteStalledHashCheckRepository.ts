import { eq } from 'drizzle-orm';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import type { StalledHashCheckRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { stalledHashChecks } from './schema.js';

export class SqliteStalledHashCheckRepository implements StalledHashCheckRepository {
  constructor(private readonly db: KoboxDatabase) {}

  find(username: Username): Promise<readonly InfoHash[]> {
    const rows = this.db.orm
      .select({ infoHash: stalledHashChecks.infoHash })
      .from(stalledHashChecks)
      .where(eq(stalledHashChecks.username, username.value))
      .all();
    return Promise.resolve(rows.map((row) => InfoHash.parse(row.infoHash)));
  }

  replace(username: Username, stalled: readonly InfoHash[]): Promise<void> {
    this.db.orm.transaction((tx) => {
      tx.delete(stalledHashChecks).where(eq(stalledHashChecks.username, username.value)).run();
      if (stalled.length > 0) {
        tx.insert(stalledHashChecks)
          .values(stalled.map((infoHash) => ({ username: username.value, infoHash: infoHash.value })))
          .run();
      }
    });
    return Promise.resolve();
  }
}
