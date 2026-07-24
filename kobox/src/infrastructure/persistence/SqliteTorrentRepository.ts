import { and, eq, sql } from 'drizzle-orm';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { Label } from '../../domain/torrent/Label.js';
import { Torrent } from '../../domain/torrent/Torrent.js';
import { TorrentState } from '../../domain/torrent/TorrentState.js';
import type { TorrentRepository } from '../../domain/torrent/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { torrents } from './schema.js';

type TorrentRow = typeof torrents.$inferSelect;

function toDomain(row: TorrentRow): Torrent {
  return Torrent.restore({
    infoHash: InfoHash.parse(row.infoHash),
    name: row.name,
    state: TorrentState.parse(row.state),
    ...(row.label !== null && { label: Label.parse(row.label) }),
    ...(row.tree !== null && { tree: row.tree }),
  });
}

export class SqliteTorrentRepository implements TorrentRepository {
  constructor(private readonly db: KoboxDatabase) {}

  findByInfoHash(username: Username, infoHash: InfoHash): Promise<Torrent | undefined> {
    const row = this.db.orm
      .select()
      .from(torrents)
      .where(and(eq(torrents.username, username.value), eq(torrents.infoHash, infoHash.value)))
      .get();
    return Promise.resolve(row ? toDomain(row) : undefined);
  }

  upsert(username: Username, torrent: Torrent): Promise<void> {
    const values = {
      username: username.value,
      infoHash: torrent.infoHash.value,
      name: torrent.name,
      label: torrent.label?.value ?? null,
      state: torrent.state.value,
      tree: torrent.tree ?? null,
    };
    this.db.orm
      .insert(torrents)
      .values(values)
      .onConflictDoUpdate({
        target: [torrents.username, torrents.infoHash],
        set: { ...values, updatedAt: sql`(datetime('now'))` },
      })
      .run();
    return Promise.resolve();
  }

  delete(username: Username, infoHash: InfoHash): Promise<void> {
    this.db.orm
      .delete(torrents)
      .where(and(eq(torrents.username, username.value), eq(torrents.infoHash, infoHash.value)))
      .run();
    return Promise.resolve();
  }

  listFor(username: Username): Promise<readonly Torrent[]> {
    return Promise.resolve(
      this.db.orm
        .select()
        .from(torrents)
        .where(eq(torrents.username, username.value))
        .all()
        .map(toDomain),
    );
  }

  deleteAllFor(username: Username): Promise<void> {
    this.db.orm.delete(torrents).where(eq(torrents.username, username.value)).run();
    return Promise.resolve();
  }
}
