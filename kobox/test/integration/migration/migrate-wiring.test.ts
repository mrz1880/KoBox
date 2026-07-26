import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContainer, buildMigrateFromMysb } from '../../../src/interfaces/composition.js';
import { buildDump } from '../../fixtures/migration/buildDump.js';

// The migrate-from-mysb CLI path, wired through the real container and real
// SQLite repos. Dry-run only, so it performs no system mutations (no useradd) —
// it just proves the composition wires the use case and reads the dump.
let dbDir: string;
let dumpDir: string;
let previousDb: string | undefined;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'kobox-migrate-db-'));
  previousDb = process.env.KOBOX_DB;
  process.env.KOBOX_DB = join(dbDir, 'kobox.db');
});

afterEach(() => {
  if (previousDb === undefined) {
    delete process.env.KOBOX_DB;
  } else {
    process.env.KOBOX_DB = previousDb;
  }
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(dumpDir, { recursive: true, force: true });
});

describe('buildMigrateFromMysb', () => {
  it('should_wire_a_dry_run_import_over_the_real_container', async () => {
    dumpDir = buildDump({
      users: [
        { username: 'alice', email: 'alice@example.org', scgiPort: 51101, rtorrentPort: 45000 },
      ],
      trackers: [
        { host: 'tracker.example.org', proto: 'https', port: 443, privacy: 'private' },
      ],
    });
    const container = buildContainer('test-migrate');
    try {
      const importer = buildMigrateFromMysb(container, { dumpDir });

      const report = await importer.execute({ apply: false });

      expect(report.apply).toBe(false);
      expect(report.users.created).toEqual(['alice']);
      expect(report.trackers.imported).toBe(1);
      // dry-run wrote nothing to the real store
      expect(await container.trackerRepo.listAll()).toHaveLength(0);
    } finally {
      container.db.close();
    }
  });

  it('should_throw_when_the_dump_is_missing', () => {
    const container = buildContainer('test-migrate-missing');
    dumpDir = mkdtempSync(join(tmpdir(), 'kobox-empty-dump-'));
    try {
      expect(() => buildMigrateFromMysb(container, { dumpDir })).toThrow();
    } finally {
      container.db.close();
    }
  });
});
