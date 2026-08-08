import { and, eq } from 'drizzle-orm';
import { MediaFile, MediaPath } from '../../domain/media/MediaFile.js';
import type { MediaEntry, MediaRepository } from '../../domain/media/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { mediaFiles } from './schema.js';

type Row = typeof mediaFiles.$inferSelect;

function toDomain(row: Row): MediaFile {
  return MediaFile.record({
    id: row.id,
    username: Username.parse(row.username),
    path: MediaPath.parse(row.path),
    sizeBytes: row.sizeBytes,
    indexedAt: row.indexedAt,
  });
}

export class SqliteMediaRepository implements MediaRepository {
  constructor(private readonly db: KoboxDatabase) {}

  // Replace rather than merge: the index must mirror the directory, so a file
  // deleted over SFTP disappears from the list instead of lingering forever.
  replaceFor(username: Username, entries: readonly MediaEntry[], now: string): Promise<void> {
    this.db.orm.transaction((tx) => {
      tx.delete(mediaFiles).where(eq(mediaFiles.username, username.value)).run();
      for (const entry of entries) {
        tx
          .insert(mediaFiles)
          .values({
            username: username.value,
            path: entry.path.value,
            sizeBytes: entry.sizeBytes,
            indexedAt: now,
          })
          .run();
      }
    });
    return Promise.resolve();
  }

  listFor(username: Username): Promise<readonly MediaFile[]> {
    const rows = this.db.orm
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.username, username.value))
      .all();
    return Promise.resolve(rows.map(toDomain));
  }

  find(username: Username, path: MediaPath): Promise<MediaFile | undefined> {
    const row = this.db.orm
      .select()
      .from(mediaFiles)
      .where(and(eq(mediaFiles.username, username.value), eq(mediaFiles.path, path.value)))
      .get();
    return Promise.resolve(row ? toDomain(row) : undefined);
  }

  removeFor(username: Username): Promise<void> {
    this.db.orm.delete(mediaFiles).where(eq(mediaFiles.username, username.value)).run();
    return Promise.resolve();
  }
}
