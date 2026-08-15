import { and, desc, eq } from 'drizzle-orm';
import { LocalPath } from '../../domain/sync/LocalPath.js';
import { SyncTransfer, type TransferState } from '../../domain/sync/SyncTransfer.js';
import type { SyncTransferRepository } from '../../domain/sync/ports.js';
import { Label } from '../../domain/torrent/Label.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { syncTransfers } from './schema.js';

type TransferRow = typeof syncTransfers.$inferSelect;

function toDomain(row: TransferRow): SyncTransfer {
  return SyncTransfer.restore({
    id: row.id,
    username: Username.parse(row.username),
    label: Label.parse(row.label),
    source: LocalPath.parse(row.source),
    state: row.state,
    attempts: row.attempts,
    ...(row.lastError !== null && { lastError: row.lastError }),
    queuedAt: row.queuedAt,
    updatedAt: row.updatedAt,
  });
}

export class SqliteSyncTransferRepository implements SyncTransferRepository {
  constructor(private readonly db: KoboxDatabase) {}

  // Returns undefined when this download is already queued: rTorrent can fire
  // `finished` more than once for one torrent, and the legacy stacked a
  // duplicate every time it did.
  queue(transfer: SyncTransfer): Promise<SyncTransfer | undefined> {
    const inserted = this.db.orm
      .insert(syncTransfers)
      .values({
        username: transfer.username.value,
        label: transfer.label.value,
        source: transfer.source.value,
        state: transfer.state,
        attempts: transfer.attempts,
        lastError: transfer.lastError ?? null,
        queuedAt: transfer.queuedAt,
        updatedAt: transfer.updatedAt,
      })
      .onConflictDoNothing()
      .returning()
      .get() as TransferRow | undefined;
    // The cast corrects drizzle: .get() is typed as always returning a row, but
    // onConflictDoNothing returns none when the row was already there — which is
    // exactly the case this method exists to report.
    return Promise.resolve(inserted === undefined ? undefined : toDomain(inserted));
  }

  save(transfer: SyncTransfer): Promise<void> {
    if (transfer.id === undefined) {
      return Promise.reject(new Error('a transfer must be queued before it can be saved'));
    }
    this.db.orm
      .update(syncTransfers)
      .set({
        state: transfer.state,
        attempts: transfer.attempts,
        lastError: transfer.lastError ?? null,
        updatedAt: transfer.updatedAt,
      })
      .where(eq(syncTransfers.id, transfer.id))
      .run();
    return Promise.resolve();
  }

  findById(id: number): Promise<SyncTransfer | undefined> {
    const row = this.db.orm.select().from(syncTransfers).where(eq(syncTransfers.id, id)).get();
    return Promise.resolve(row === undefined ? undefined : toDomain(row));
  }

  // Oldest first: a queue that serves the newest first starves the ones that
  // have been waiting since last night.
  listWaiting(username: Username, limit?: number): Promise<readonly SyncTransfer[]> {
    const query = this.db.orm
      .select()
      .from(syncTransfers)
      .where(and(eq(syncTransfers.username, username.value), eq(syncTransfers.state, 'waiting')))
      .orderBy(syncTransfers.id);
    const rows = limit === undefined ? query.all() : query.limit(limit).all();
    return Promise.resolve(rows.map(toDomain));
  }

  listRecent(username: Username, limit: number): Promise<readonly SyncTransfer[]> {
    const rows = this.db.orm
      .select()
      .from(syncTransfers)
      .where(eq(syncTransfers.username, username.value))
      .orderBy(desc(syncTransfers.id))
      .limit(limit)
      .all();
    return Promise.resolve(rows.map(toDomain));
  }

  countByState(username: Username, state: TransferState): Promise<number> {
    const rows = this.db.orm
      .select({ id: syncTransfers.id })
      .from(syncTransfers)
      .where(and(eq(syncTransfers.username, username.value), eq(syncTransfers.state, state)))
      .all();
    return Promise.resolve(rows.length);
  }
}
