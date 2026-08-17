import { eq } from 'drizzle-orm';
import type { DiskUsageRepository, DiskUsageSample } from '../../domain/user/ports.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { diskSamples } from './schema.js';

export class SqliteDiskUsageRepository implements DiskUsageRepository {
  constructor(private readonly db: KoboxDatabase) {}

  save(sample: DiskUsageSample): Promise<void> {
    const values = {
      username: sample.username.value,
      usedBytes: sample.used.toBytes(),
      sampledAt: sample.sampledAt,
    };
    this.db.orm
      .insert(diskSamples)
      .values(values)
      .onConflictDoUpdate({ target: diskSamples.username, set: values })
      .run();
    return Promise.resolve();
  }

  find(username: Username): Promise<DiskUsageSample | undefined> {
    const row = this.db.orm
      .select()
      .from(diskSamples)
      .where(eq(diskSamples.username, username.value))
      .get();
    return Promise.resolve(
      row === undefined
        ? undefined
        : {
            username: Username.parse(row.username),
            used: Quota.bytes(row.usedBytes),
            sampledAt: row.sampledAt,
          },
    );
  }
}
