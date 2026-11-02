import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CleanupReport } from '../../../src/domain/space/CleanupReport.js';
import { Quota } from '../../../src/domain/user/Quota.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteCleanupReportRepository } from '../../../src/infrastructure/persistence/SqliteCleanupReportRepository.js';

const alice = Username.parse('alice');
const bob = Username.parse('bob');

const report = CleanupReport.of({
  // above 4 GiB: the bytes must survive the round trip as an integer
  deleted: [{ name: 'Example Film', size: Quota.gib(12) }],
  skipped: [
    { name: 'Example Show', reason: 'noLongerQualifies' },
    { name: 'C'.repeat(40), reason: 'gone' },
  ],
  at: '2026-11-20 12:00:00',
  trigger: 'member',
});

let dir: string;
let db: KoboxDatabase;
let repo: SqliteCleanupReportRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-cleanup-reports-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  repo = new SqliteCleanupReportRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteCleanupReportRepository', () => {
  it('should_give_back_the_report_saved_for_a_member', async () => {
    await repo.save(alice, report);

    expect(await repo.find(alice)).toEqual(report);
    expect(await repo.find(bob)).toBeUndefined();
  });

  it('should_keep_only_the_latest_report_of_a_member', async () => {
    const later = CleanupReport.of({
      deleted: [],
      skipped: [],
      at: '2026-11-21 08:00:00',
      trigger: 'member',
    });
    await repo.save(alice, report);

    await repo.save(alice, later);

    expect(await repo.find(alice)).toEqual(later);
  });

  it('should_remember_that_a_cleanup_ran_on_its_own', async () => {
    const automatic = CleanupReport.of({
      deleted: [{ name: 'Example Film', size: Quota.gib(12) }],
      skipped: [],
      at: '2026-11-20 12:00:00',
      trigger: 'automatic',
    });

    await repo.save(alice, automatic);

    expect((await repo.find(alice))?.trigger).toBe('automatic');
  });

  // the home keeps telling what KoBox deleted on its own after a cleanup by hand
  it('should_keep_the_latest_report_of_each_trigger_and_find_the_most_recent', async () => {
    const automatic = CleanupReport.of({
      deleted: [{ name: 'Example Film', size: Quota.gib(12) }],
      skipped: [],
      at: '2026-11-19 12:00:00',
      trigger: 'automatic',
    });
    await repo.save(alice, automatic);

    await repo.save(alice, report);

    expect(await repo.findTriggeredBy(alice, 'automatic')).toEqual(automatic);
    expect(await repo.findTriggeredBy(alice, 'member')).toEqual(report);
    expect(await repo.find(alice)).toEqual(report);
    expect(await repo.findTriggeredBy(bob, 'automatic')).toBeUndefined();
  });
});
