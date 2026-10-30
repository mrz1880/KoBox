import { eq } from 'drizzle-orm';
import type { VolumeSample, VolumeSampleRepository } from '../../domain/user/ports.js';
import { Quota } from '../../domain/user/Quota.js';
import { VolumeSpace } from '../../domain/user/VolumeSpace.js';
import type { KoboxDatabase } from './db.js';
import { volumeSamples } from './schema.js';

const ONLY_ROW = 1;

export class SqliteVolumeSampleRepository implements VolumeSampleRepository {
  constructor(private readonly db: KoboxDatabase) {}

  save(sample: VolumeSample): Promise<void> {
    const values = {
      id: ONLY_ROW,
      freeBytes: sample.space.free.toBytes(),
      sizeBytes: sample.space.size.toBytes(),
      measuredAt: sample.measuredAt,
    };
    this.db.orm
      .insert(volumeSamples)
      .values(values)
      .onConflictDoUpdate({ target: volumeSamples.id, set: values })
      .run();
    return Promise.resolve();
  }

  find(): Promise<VolumeSample | undefined> {
    const row = this.db.orm
      .select()
      .from(volumeSamples)
      .where(eq(volumeSamples.id, ONLY_ROW))
      .get();
    return Promise.resolve(
      row === undefined
        ? undefined
        : {
            space: VolumeSpace.of({
              free: Quota.bytes(row.freeBytes),
              size: Quota.bytes(row.sizeBytes),
            }),
            measuredAt: row.measuredAt,
          },
    );
  }
}
