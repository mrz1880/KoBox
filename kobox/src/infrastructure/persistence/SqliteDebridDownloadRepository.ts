import { eq } from 'drizzle-orm';
import { DebridDownload } from '../../domain/ddl/DebridDownload.js';
import { DownloadCategory } from '../../domain/ddl/DownloadCategory.js';
import { DownloadGid } from '../../domain/ddl/DownloadGid.js';
import { FilehosterLink } from '../../domain/ddl/FilehosterLink.js';
import type { DebridDownloadRepository } from '../../domain/ddl/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { debridDownloads } from './schema.js';

type Row = typeof debridDownloads.$inferSelect;

function toDomain(row: Row): DebridDownload {
  return DebridDownload.restore({
    id: row.id,
    username: Username.parse(row.username),
    category: DownloadCategory.parse(row.category),
    sourceLink: FilehosterLink.parse(row.sourceLink),
    status: row.status,
    ...(row.gid !== null && { gid: DownloadGid.parse(row.gid) }),
    ...(row.filename !== null && { filename: row.filename }),
    ...(row.error !== null && { error: row.error }),
    createdAt: row.createdAt,
  });
}

export class SqliteDebridDownloadRepository implements DebridDownloadRepository {
  constructor(private readonly db: KoboxDatabase) {}

  save(download: DebridDownload): Promise<DebridDownload> {
    const values = {
      username: download.username.value,
      category: download.category.value,
      sourceLink: download.sourceLink.value,
      status: download.status,
      gid: download.gid?.value ?? null,
      filename: download.filename ?? null,
      error: download.error ?? null,
      createdAt: download.createdAt,
    };
    if (download.id !== undefined) {
      this.db.orm
        .update(debridDownloads)
        .set(values)
        .where(eq(debridDownloads.id, download.id))
        .run();
      return Promise.resolve(download);
    }
    const inserted = this.db.orm
      .insert(debridDownloads)
      .values(values)
      .returning({ id: debridDownloads.id })
      .get();
    return Promise.resolve(download.identifiedBy(inserted.id));
  }

  findById(id: number): Promise<DebridDownload | undefined> {
    const row = this.db.orm.select().from(debridDownloads).where(eq(debridDownloads.id, id)).get();
    return Promise.resolve(row ? toDomain(row) : undefined);
  }

  listActive(): Promise<readonly DebridDownload[]> {
    const rows = this.db.orm
      .select()
      .from(debridDownloads)
      .where(eq(debridDownloads.status, 'downloading'))
      .all();
    return Promise.resolve(rows.map(toDomain));
  }

  listForUser(username: Username): Promise<readonly DebridDownload[]> {
    const rows = this.db.orm
      .select()
      .from(debridDownloads)
      .where(eq(debridDownloads.username, username.value))
      .all();
    return Promise.resolve(rows.map(toDomain));
  }
}
