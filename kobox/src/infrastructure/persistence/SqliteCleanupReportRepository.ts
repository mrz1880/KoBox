import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CleanupReport, SKIP_REASONS, type CleanupTrigger } from '../../domain/space/CleanupReport.js';
import type { CleanupReportRepository } from '../../domain/space/ports.js';
import { Quota } from '../../domain/user/Quota.js';
import type { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { cleanupReports } from './schema.js';

// The lines as stored: sizes in bytes, the freed total left out since the
// deleted lines already say it.
const storedLines = z.object({
  deleted: z.array(z.object({ name: z.string(), sizeBytes: z.number().int().nonnegative() })),
  skipped: z.array(z.object({ name: z.string(), reason: z.enum(SKIP_REASONS) })),
});

export class SqliteCleanupReportRepository implements CleanupReportRepository {
  constructor(private readonly db: KoboxDatabase) {}

  save(username: Username, report: CleanupReport): Promise<void> {
    const lines: z.infer<typeof storedLines> = {
      deleted: report.deleted.map((line) => ({ name: line.name, sizeBytes: line.size.toBytes() })),
      skipped: [...report.skipped],
    };
    const values = {
      trigger: report.trigger,
      reportJson: JSON.stringify(lines),
      at: report.at,
    } as const;
    this.db.orm
      .insert(cleanupReports)
      .values({ username: username.value, ...values })
      .onConflictDoUpdate({ target: [cleanupReports.username, cleanupReports.trigger], set: values })
      .run();
    return Promise.resolve();
  }

  // stamps order as strings in time
  find(username: Username): Promise<CleanupReport | undefined> {
    const row = this.db.orm
      .select()
      .from(cleanupReports)
      .where(eq(cleanupReports.username, username.value))
      .orderBy(desc(cleanupReports.at))
      .limit(1)
      .get();
    return Promise.resolve(row === undefined ? undefined : reportOf(row));
  }

  findTriggeredBy(username: Username, trigger: CleanupTrigger): Promise<CleanupReport | undefined> {
    const row = this.db.orm
      .select()
      .from(cleanupReports)
      .where(and(eq(cleanupReports.username, username.value), eq(cleanupReports.trigger, trigger)))
      .get();
    return Promise.resolve(row === undefined ? undefined : reportOf(row));
  }
}

function reportOf(row: typeof cleanupReports.$inferSelect): CleanupReport {
  const lines = storedLines.parse(JSON.parse(row.reportJson));
  return CleanupReport.of({
    deleted: lines.deleted.map((line) => ({ name: line.name, size: Quota.bytes(line.sizeBytes) })),
    skipped: lines.skipped,
    at: row.at,
    trigger: row.trigger,
  });
}
