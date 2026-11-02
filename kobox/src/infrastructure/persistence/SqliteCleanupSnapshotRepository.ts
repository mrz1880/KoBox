import { asc, eq, sql } from 'drizzle-orm';
import { CleanupCandidate } from '../../domain/space/CleanupCandidate.js';
import { SeedRule } from '../../domain/space/SeedRule.js';
import type { CleanupSnapshot, CleanupSnapshotRepository } from '../../domain/space/ports.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { Quota } from '../../domain/user/Quota.js';
import type { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { fromRatioMilli, toRatioMilli } from './ratioMilli.js';
import { cleanupCandidates, cleanupSnapshots } from './schema.js';

export class SqliteCleanupSnapshotRepository implements CleanupSnapshotRepository {
  constructor(private readonly db: KoboxDatabase) {}

  // One transaction: the portal never reads a time with half its candidates.
  replace(
    username: Username,
    candidates: readonly CleanupCandidate[],
    takenAt: string,
    judgedBy: SeedRule,
  ): Promise<void> {
    const values = {
      takenAt,
      ruleRatioMilli: judgedBy.ratio === undefined ? null : toRatioMilli(judgedBy.ratio),
      ruleDays: judgedBy.days,
    };
    this.db.orm.transaction((tx) => {
      tx.insert(cleanupSnapshots)
        .values({ username: username.value, ...values })
        .onConflictDoUpdate({ target: cleanupSnapshots.username, set: values })
        .run();
      tx.delete(cleanupCandidates).where(eq(cleanupCandidates.username, username.value)).run();
      if (candidates.length > 0) {
        tx.insert(cleanupCandidates)
          .values(
            candidates.map((candidate) => ({
              username: username.value,
              infoHash: candidate.infoHash.value,
              name: candidate.name,
              sizeBytes: candidate.size.toBytes(),
              ratioMilli: toRatioMilli(candidate.ratio),
              finishedAt: candidate.finishedAt,
              path: candidate.path,
              reason: candidate.reason,
            })),
          )
          .run();
      }
    });
    return Promise.resolve();
  }

  find(username: Username): Promise<CleanupSnapshot | undefined> {
    const snapshot = this.db.orm
      .select()
      .from(cleanupSnapshots)
      .where(eq(cleanupSnapshots.username, username.value))
      .get();
    if (snapshot === undefined) {
      return Promise.resolve(undefined);
    }
    // rowid keeps the order the candidates were given in
    const rows = this.db.orm
      .select()
      .from(cleanupCandidates)
      .where(eq(cleanupCandidates.username, username.value))
      .orderBy(asc(sql`rowid`))
      .all();
    return Promise.resolve({
      candidates: rows.map((row) =>
        CleanupCandidate.restore({
          infoHash: InfoHash.parse(row.infoHash),
          name: row.name,
          size: Quota.bytes(row.sizeBytes),
          ratio: fromRatioMilli(row.ratioMilli),
          finishedAt: row.finishedAt,
          path: row.path,
          reason: row.reason,
        }),
      ),
      takenAt: snapshot.takenAt,
      judgedBy: SeedRule.of({
        ratio: snapshot.ruleRatioMilli === null ? undefined : fromRatioMilli(snapshot.ruleRatioMilli),
        days: snapshot.ruleDays,
      }),
    });
  }
}
