import { and, eq } from 'drizzle-orm';
import { Blocklist, type BlocklistUpdate } from '../../domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../domain/tracker/BlocklistUrl.js';
import type { BlocklistRepository } from '../../domain/tracker/ports.js';
import type { KoboxDatabase } from './db.js';
import { blocklists } from './schema.js';

type BlocklistRow = typeof blocklists.$inferSelect;

function restore(row: BlocklistRow): Blocklist {
  let lastUpdate: BlocklistUpdate | undefined;
  if (row.lastUpdateStatus === 'failed') {
    lastUpdate = { status: 'failed' };
  } else if (row.lastUpdateStatus === 'ok' && row.lastUpdateAt !== null) {
    lastUpdate = { status: 'ok', at: row.lastUpdateAt };
  }
  return Blocklist.restore({
    source: BlocklistSource.parse(row.source),
    author: row.author,
    name: row.name,
    url: BlocklistUrl.parse(row.url),
    subscription: row.subscription === 1,
    enabled: row.enabled === 1,
    ...(lastUpdate !== undefined && { lastUpdate }),
    ...(row.sha256 !== null && { sha256: row.sha256 }),
  });
}

export class SqliteBlocklistRepository implements BlocklistRepository {
  constructor(private readonly db: KoboxDatabase) {}

  listAll(): Promise<readonly Blocklist[]> {
    return Promise.resolve(this.db.orm.select().from(blocklists).all().map(restore));
  }

  listEnabled(): Promise<readonly Blocklist[]> {
    const rows = this.db.orm.select().from(blocklists).where(eq(blocklists.enabled, 1)).all();
    return Promise.resolve(rows.map(restore));
  }

  findBySourceAuthorName(
    source: BlocklistSource,
    author: string,
    name: string,
  ): Promise<Blocklist | undefined> {
    const row = this.db.orm
      .select()
      .from(blocklists)
      .where(
        and(
          eq(blocklists.source, source.value),
          eq(blocklists.author, author),
          eq(blocklists.name, name),
        ),
      )
      .get();
    return Promise.resolve(row ? restore(row) : undefined);
  }

  save(blocklist: Blocklist): Promise<Blocklist> {
    const values = {
      source: blocklist.source.value,
      author: blocklist.author,
      name: blocklist.name,
      url: blocklist.url.value,
      subscription: blocklist.subscription ? 1 : 0,
      enabled: blocklist.enabled ? 1 : 0,
      lastUpdateStatus: blocklist.lastUpdate?.status ?? null,
      lastUpdateAt: blocklist.lastUpdate?.status === 'ok' ? blocklist.lastUpdate.at : null,
      sha256: blocklist.sha256 ?? null,
    };
    this.db.orm
      .insert(blocklists)
      .values(values)
      .onConflictDoUpdate({
        target: [blocklists.source, blocklists.author, blocklists.name],
        set: values,
      })
      .run();
    return Promise.resolve(blocklist);
  }
}
