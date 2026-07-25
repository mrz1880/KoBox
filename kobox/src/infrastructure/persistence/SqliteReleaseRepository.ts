import { desc, eq } from 'drizzle-orm';
import type {
  ReleaseRecord,
  ReleaseRepositoryPort,
  ReleaseState,
} from '../../application/maintenance/ReleaseRepositoryPort.js';
import type { KoboxDatabase } from './db.js';
import { releases } from './schema.js';

type ReleaseRow = typeof releases.$inferSelect;

function toRecord(row: ReleaseRow): ReleaseRecord {
  return {
    id: row.id,
    ref: row.ref,
    path: row.path,
    state: row.state,
    createdAt: row.createdAt,
    ...(row.switchedAt !== null && { switchedAt: row.switchedAt }),
  };
}

export class SqliteReleaseRepository implements ReleaseRepositoryPort {
  constructor(private readonly db: KoboxDatabase) {}

  record(ref: string, path: string, now: string): Promise<number> {
    try {
      const inserted = this.db.orm
        .insert(releases)
        .values({ ref, path, state: 'staged', createdAt: now })
        .returning({ id: releases.id })
        .get();
      return Promise.resolve(inserted.id);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  setState(id: number, state: ReleaseState, now: string): Promise<void> {
    this.db.orm
      .update(releases)
      .set({ state, ...(state === 'current' && { switchedAt: now }) })
      .where(eq(releases.id, id))
      .run();
    return Promise.resolve();
  }

  findByState(state: ReleaseState): Promise<ReleaseRecord | undefined> {
    const row = this.db.orm
      .select()
      .from(releases)
      .where(eq(releases.state, state))
      .orderBy(desc(releases.id))
      .limit(1)
      .get();
    return Promise.resolve(row ? toRecord(row) : undefined);
  }

  list(): Promise<readonly ReleaseRecord[]> {
    const rows = this.db.orm.select().from(releases).orderBy(desc(releases.id)).all();
    return Promise.resolve(rows.map(toRecord));
  }
}
