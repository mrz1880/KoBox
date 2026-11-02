import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteComponentRegistry } from '../../../src/infrastructure/persistence/SqliteComponentRegistry.js';
import { SqliteBlocklistRepository } from '../../../src/infrastructure/persistence/SqliteBlocklistRepository.js';
import { BlocklistSource } from '../../../src/domain/tracker/BlocklistSource.js';
import { SeedRule } from '../../../src/domain/space/SeedRule.js';
import { Username } from '../../../src/domain/user/Username.js';
import { SqliteCleanupSnapshotRepository } from '../../../src/infrastructure/persistence/SqliteCleanupSnapshotRepository.js';
import { SqliteSeedRuleRepository } from '../../../src/infrastructure/persistence/SqliteSeedRuleRepository.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-db-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A box whose schema stops just before the migration tagged `firstToCome`:
// returns its database, still open, so the test can put in what such a box held.
function boxBefore(firstToCome: string): Database.Database {
  const before = join(dir, 'drizzle-before');
  cpSync('drizzle', before, { recursive: true });
  const journalPath = join(before, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(
    0,
    journal.entries.findIndex((entry) => entry.tag === firstToCome),
  );
  writeFileSync(journalPath, JSON.stringify(journal));
  const old = new Database(join(dir, 'kobox.db'));
  migrate(drizzle(old), { migrationsFolder: before });
  return old;
}

describe('KoboxDatabase', () => {
  it('should_open_on_a_fresh_box_where_its_directory_does_not_exist_yet', () => {
    // `kobox install` is the first thing to open the database on a new box,
    // before the kobox-core component has made /var/lib/kobox
    const path = join(dir, 'var/lib/kobox/kobox.db');

    const db = KoboxDatabase.open(path);
    db.close();

    expect(existsSync(path)).toBe(true);
  });

  it('should_give_every_member_already_there_a_vpn_host_of_their_own', () => {
    // a box that predates the VPN addresses, with members already in it
    const old = boxBefore('0026_member-vpn-host');
    const insert = old.prepare(
      "INSERT INTO users (username, email, quota_bytes, scgi_port, rtorrent_port, proxy_port, status) VALUES (?, 'm@example.org', 1, ?, ?, 8080, 'active')",
    );
    insert.run('alice', 51101, 45000);
    insert.run('bob', 51102, 45001);
    insert.run('carol', 51103, 45002);
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const hosts = db.raw.prepare('SELECT username, vpn_host FROM users ORDER BY id').all();
    db.close();

    expect(hosts).toEqual([
      { username: 'alice', vpn_host: 2 },
      { username: 'bob', vpn_host: 3 },
      { username: 'carol', vpn_host: 4 },
    ]);
  });

  it('should_forget_the_retired_download_engine_on_a_box_that_had_it', async () => {
    // a box from before debrid downloads were retired: aria2 recorded as an
    // installed component, and a poll still waiting in the queue
    const old = boxBefore('0031_retire-debrid-downloads');
    old
      .prepare("INSERT INTO components (name, state, updated_at) VALUES (?, 'installed', '2026-10-28 10:00:00')")
      .run('aria2');
    old
      .prepare("INSERT INTO components (name, state, updated_at) VALUES (?, 'installed', '2026-10-28 10:00:00')")
      .run('nginx');
    old
      .prepare("INSERT INTO jobs (type, payload_json, status) VALUES (?, '{}', ?)")
      .run('poll-debrid-downloads', 'pending');
    old
      .prepare("INSERT INTO jobs (type, payload_json, status) VALUES (?, '{}', ?)")
      .run('index-media', 'pending');
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    // a row naming a component KoBox no longer knows would make every read of
    // the registry throw, the admin Health page first
    const components = await new SqliteComponentRegistry(db).list();
    const pending = db.raw.prepare("SELECT type FROM jobs WHERE status = 'pending'").all();
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'debrid%'")
      .all();
    db.close();

    expect(components.map((record) => record.name.value)).toEqual(['nginx']);
    // nothing is left to execute a job of the retired feature
    expect(pending).toEqual([{ type: 'index-media' }]);
    expect(tables).toEqual([]);
  });

  it('should_count_the_outage_of_a_list_already_failing_from_the_upgrade', async () => {
    // before 0033 a failing list did not say since when; dropping it back to
    // "never updated" would hide the failure from the blocklists page
    const old = boxBefore('0033_blocklist-outage');
    old
      .prepare(
        "INSERT INTO blocklists (source, author, name, url, enabled, last_update_status) VALUES ('iblocklist', 'Example Org', 'level1', 'https://list.example.org/?list=abc', 1, 'failed')",
      )
      .run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const list = await new SqliteBlocklistRepository(db).findBySourceAuthorName(
      BlocklistSource.parse('iblocklist'),
      'Example Org',
      'level1',
    );
    db.close();

    expect(list?.lastUpdate).toMatchObject({ status: 'failed', reported: false });
  });

  it('should_start_a_box_from_before_space_cleanup_on_the_default_rule_with_no_snapshot', async () => {
    // a box that predates space cleanup, with a member already in it
    const old = boxBefore('0034_space-cleanup');
    old
      .prepare(
        "INSERT INTO users (username, email, quota_bytes, scgi_port, rtorrent_port, proxy_port, status) VALUES ('alice', 'alice@example.org', 1, 51101, 45000, 8080, 'active')",
      )
      .run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const alice = Username.parse('alice');
    const snapshots = new SqliteCleanupSnapshotRepository(db);
    const before = await snapshots.find(alice);
    await snapshots.replace(alice, [], '2026-11-02T09:00:00.000Z');
    const after = await snapshots.find(alice);
    const rule = await new SqliteSeedRuleRepository(db).get();
    const reports = db.raw.prepare('SELECT username FROM cleanup_reports').all();
    db.close();

    expect(rule).toEqual(SeedRule.DEFAULT);
    expect(before).toBeUndefined();
    expect(after).toEqual({ candidates: [], takenAt: '2026-11-02T09:00:00.000Z' });
    expect(reports).toEqual([]);
  });
});
