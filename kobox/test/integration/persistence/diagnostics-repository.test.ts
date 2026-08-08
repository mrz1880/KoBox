import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteDiagnosticsRepository } from '../../../src/infrastructure/persistence/SqliteDiagnosticsRepository.js';

let dir: string;
let db: KoboxDatabase;
let repo: SqliteDiagnosticsRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-diagnostics-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  repo = new SqliteDiagnosticsRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteDiagnosticsRepository', () => {
  it('should_return_nothing_before_anything_was_captured', async () => {
    expect(await repo.findLog('nginx')).toBeUndefined();
    expect(await repo.findPackages()).toBeUndefined();
  });

  it('should_replace_a_units_excerpt_rather_than_accumulate_one_per_capture', async () => {
    await repo.saveLog({ unit: 'nginx', content: 'old', capturedAt: '2026-08-01 08:00:00' });

    await repo.saveLog({ unit: 'nginx', content: 'fresh', capturedAt: '2026-08-08 09:00:00' });

    // a snapshot, not an archive: 200 lines per unit per capture would grow the
    // database without anyone ever reading the older copies
    const found = await repo.findLog('nginx');
    expect(found?.content).toBe('fresh');
    expect(found?.capturedAt).toBe('2026-08-08 09:00:00');
  });

  it('should_keep_each_units_excerpt_apart', async () => {
    await repo.saveLog({ unit: 'nginx', content: 'from nginx', capturedAt: '2026-08-08 09:00:00' });
    await repo.saveLog({
      unit: 'kobox-worker',
      content: 'from the worker',
      capturedAt: '2026-08-08 09:01:00',
    });

    expect((await repo.findLog('nginx'))?.content).toBe('from nginx');
    expect((await repo.findLog('kobox-worker'))?.content).toBe('from the worker');
  });

  it('should_replace_the_package_listing_on_each_check', async () => {
    await repo.savePackages({
      listing: 'openssl/stable 3.0.14',
      upgradableCount: 1,
      checkedAt: '2026-08-01 08:00:00',
    });

    await repo.savePackages({ listing: '', upgradableCount: 0, checkedAt: '2026-08-08 09:00:00' });

    const found = await repo.findPackages();
    expect(found?.upgradableCount).toBe(0);
    expect(found?.checkedAt).toBe('2026-08-08 09:00:00');
  });
});
