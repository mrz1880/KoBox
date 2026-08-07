import { desc } from 'drizzle-orm';
import { Speedtest } from '../../domain/maintenance/speedtest.js';
import { Bandwidth } from '../../domain/security/Bandwidth.js';
import type { SpeedtestRepositoryPort } from '../../application/maintenance/SpeedtestPort.js';
import type { KoboxDatabase } from './db.js';
import { speedtests } from './schema.js';

type Row = typeof speedtests.$inferSelect;

function toDomain(row: Row): Speedtest {
  return Speedtest.record({
    id: row.id,
    download: Bandwidth.bitsPerSecond(row.downloadBps),
    upload: Bandwidth.bitsPerSecond(row.uploadBps),
    latencyMs: row.latencyMs,
    server: row.server,
    measuredAt: row.measuredAt,
  });
}

export class SqliteSpeedtestRepository implements SpeedtestRepositoryPort {
  constructor(private readonly db: KoboxDatabase) {}

  save(result: Speedtest): Promise<Speedtest> {
    const inserted = this.db.orm
      .insert(speedtests)
      .values({
        downloadBps: result.download.bps,
        uploadBps: result.upload.bps,
        latencyMs: result.latencyMs,
        server: result.server,
        measuredAt: result.measuredAt,
      })
      .returning({ id: speedtests.id })
      .get();
    return Promise.resolve(result.identifiedBy(inserted.id));
  }

  listRecent(limit: number): Promise<readonly Speedtest[]> {
    const rows = this.db.orm
      .select()
      .from(speedtests)
      .orderBy(desc(speedtests.measuredAt))
      .limit(limit)
      .all();
    return Promise.resolve(rows.map(toDomain));
  }
}
