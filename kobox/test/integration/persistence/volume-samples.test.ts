import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Quota } from '../../../src/domain/user/Quota.js';
import { VolumeSpace } from '../../../src/domain/user/VolumeSpace.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteVolumeSampleRepository } from '../../../src/infrastructure/persistence/SqliteVolumeSampleRepository.js';

let dir: string;
let db: KoboxDatabase;

// a real disk of several TiB: the bytes must survive SQLite as integers
const FOUR_TIB = Quota.gib(4096);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-volume-samples-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteVolumeSampleRepository', () => {
  it('should_know_nothing_before_the_first_reading', async () => {
    expect(await new SqliteVolumeSampleRepository(db).find()).toBeUndefined();
  });

  it('should_keep_only_the_latest_reading_of_the_volume', async () => {
    const repo = new SqliteVolumeSampleRepository(db);
    await repo.save({
      space: VolumeSpace.of({ free: Quota.gib(900), size: FOUR_TIB }),
      measuredAt: '2026-10-30 18:00:00',
    });
    await repo.save({
      space: VolumeSpace.of({ free: Quota.gib(850), size: FOUR_TIB }),
      measuredAt: '2026-10-30 19:00:00',
    });

    const found = await repo.find();
    expect(found?.space.free.toGib()).toBe(850);
    expect(found?.space.size.toBytes()).toBe(FOUR_TIB.toBytes());
    expect(found?.measuredAt).toBe('2026-10-30 19:00:00');
  });
});
