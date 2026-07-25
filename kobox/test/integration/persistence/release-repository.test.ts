import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteReleaseRepository } from '../../../src/infrastructure/persistence/SqliteReleaseRepository.js';

let dir: string;
let db: KoboxDatabase;
let repo: SqliteReleaseRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-releases-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  repo = new SqliteReleaseRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteReleaseRepository', () => {
  it('should_record_a_staged_release_and_find_it_by_state', async () => {
    const id = await repo.record('v2.0.0', '/opt/kobox/releases/abc123', '2026-07-25 10:00:00');

    const staged = await repo.findByState('staged');

    expect(staged?.id).toBe(id);
    expect(staged?.ref).toBe('v2.0.0');
    expect(staged?.path).toBe('/opt/kobox/releases/abc123');
    expect(staged?.switchedAt).toBeUndefined();
  });

  it('should_walk_a_release_through_the_switch_lifecycle', async () => {
    const first = await repo.record('v1.0.0', '/opt/kobox/releases/aaa', '2026-07-25 09:00:00');
    await repo.setState(first, 'current', '2026-07-25 09:05:00');
    const second = await repo.record('v2.0.0', '/opt/kobox/releases/bbb', '2026-07-25 10:00:00');

    await repo.setState(first, 'previous', '2026-07-25 10:05:00');
    await repo.setState(second, 'current', '2026-07-25 10:05:00');

    expect((await repo.findByState('current'))?.ref).toBe('v2.0.0');
    expect((await repo.findByState('previous'))?.ref).toBe('v1.0.0');
    expect((await repo.findByState('current'))?.switchedAt).toBe('2026-07-25 10:05:00');
  });

  it('should_list_releases_newest_first_and_reject_duplicate_paths', async () => {
    await repo.record('v1.0.0', '/opt/kobox/releases/aaa', '2026-07-25 09:00:00');
    await repo.record('v2.0.0', '/opt/kobox/releases/bbb', '2026-07-25 10:00:00');

    const rows = await repo.list();
    expect(rows.map((row) => row.ref)).toEqual(['v2.0.0', 'v1.0.0']);
    await expect(
      repo.record('v3.0.0', '/opt/kobox/releases/aaa', '2026-07-25 11:00:00'),
    ).rejects.toThrow();
  });
});
