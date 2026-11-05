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
import { CleanupReport } from '../../../src/domain/space/CleanupReport.js';
import { SeedRule } from '../../../src/domain/space/SeedRule.js';
import { Username } from '../../../src/domain/user/Username.js';
import { SqliteCleanupReportRepository } from '../../../src/infrastructure/persistence/SqliteCleanupReportRepository.js';
import { SqliteCleanupSnapshotRepository } from '../../../src/infrastructure/persistence/SqliteCleanupSnapshotRepository.js';
import { SqliteSeedRuleRepository } from '../../../src/infrastructure/persistence/SqliteSeedRuleRepository.js';
import { SqliteSyncDestinationRepository } from '../../../src/infrastructure/persistence/SqliteSyncDestinationRepository.js';
import { SqliteSpacePreferenceRepository } from '../../../src/infrastructure/persistence/SqliteSpacePreferenceRepository.js';

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
    await snapshots.replace(alice, [], '2026-11-02T09:00:00.000Z', SeedRule.DEFAULT);
    const after = await snapshots.find(alice);
    const rule = await new SqliteSeedRuleRepository(db).get();
    const reports = db.raw.prepare('SELECT username FROM cleanup_reports').all();
    db.close();

    expect(rule).toEqual(SeedRule.DEFAULT);
    expect(before).toBeUndefined();
    expect(after).toEqual({
      candidates: [],
      takenAt: '2026-11-02T09:00:00.000Z',
      judgedBy: SeedRule.DEFAULT,
    });
    expect(reports).toEqual([]);
  });

  it('should_leave_automatic_cleanup_off_for_every_member_of_a_box_from_before_it', async () => {
    // a box that predates the space preferences, with a member already in it
    const old = boxBefore('0035_space-preferences');
    old
      .prepare(
        "INSERT INTO users (username, email, quota_bytes, scgi_port, rtorrent_port, proxy_port, status) VALUES ('alice', 'alice@example.org', 1, 51101, 45000, 8080, 'active')",
      )
      .run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const alice = Username.parse('alice');
    const preferences = new SqliteSpacePreferenceRepository(db);
    const before = await preferences.find(alice);
    await preferences.chooseAutomatic(alice, 'sentOnly');
    const after = await preferences.find(alice);
    db.close();

    expect(before).toEqual({ automatic: 'off', warned: false });
    expect(after).toEqual({ automatic: 'sentOnly', warned: false });
  });

  it('should_keep_every_member_of_a_box_from_before_own_seed_rules_on_the_box_rule', async () => {
    // a member who already chose automatic cleanup before members had a rule
    const old = boxBefore('0036_member-seed-rule');
    old
      .prepare(
        "INSERT INTO users (username, email, quota_bytes, scgi_port, rtorrent_port, proxy_port, status) VALUES ('alice', 'alice@example.org', 1, 51101, 45000, 8080, 'active')",
      )
      .run();
    old
      .prepare("INSERT INTO space_preferences (username, automatic, warned) VALUES ('alice', 'sentOnly', 1)")
      .run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const alice = Username.parse('alice');
    const preferences = new SqliteSpacePreferenceRepository(db);
    const rule = await preferences.findSeedRule(alice);
    const kept = await preferences.find(alice);
    db.close();

    expect(rule).toEqual({ kind: 'box' });
    expect(kept).toEqual({ automatic: 'sentOnly', warned: true });
  });

  it('should_keep_the_report_of_a_box_from_before_one_report_per_trigger', async () => {
    // an automatic report saved when a member had a single report
    const old = boxBefore('0037_cleanup-report-per-trigger');
    old
      .prepare(
        `INSERT INTO cleanup_reports (username, "trigger", report_json, at) VALUES ('alice', 'automatic', '{"deleted":[],"skipped":[]}', '2026-11-01 10:00:00')`,
      )
      .run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const alice = Username.parse('alice');
    const reports = new SqliteCleanupReportRepository(db);
    await reports.save(
      alice,
      CleanupReport.of({ deleted: [], skipped: [], at: '2026-11-02 10:00:00', trigger: 'member' }),
    );
    const automatic = await reports.findTriggeredBy(alice, 'automatic');
    const latest = await reports.find(alice);
    db.close();

    expect(automatic?.at).toBe('2026-11-01 10:00:00');
    expect(latest?.trigger).toBe('member');
  });

  it('should_word_a_list_from_before_judged_rules_after_the_rule_each_member_had', async () => {
    // alice set her own rule on days alone, bob kept the box's rule an admin set
    const old = boxBefore('0038_snapshot-judged-by');
    for (const username of ['alice', 'bob']) {
      old.prepare('INSERT INTO cleanup_snapshots (username, taken_at) VALUES (?, ?)').run(username, '2026-11-02 09:00:00');
    }
    old
      .prepare(
        "INSERT INTO cleanup_candidates (username, info_hash, name, size_bytes, ratio_milli, finished_at, path, reason) VALUES ('alice', ?, 'Example Film', 1, 2000, '2026-10-01T08:00:00.000Z', '/home/alice/rtorrent/complete/Example Film', 'seeded')",
      )
      .run('A'.repeat(40));
    old
      .prepare("INSERT INTO space_preferences (username, own_rule_days) VALUES ('alice', 14)")
      .run();
    old.prepare('INSERT INTO seed_rule (id, ratio_milli, days) VALUES (1, 1500, 10)').run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const snapshots = new SqliteCleanupSnapshotRepository(db);
    const alice = await snapshots.find(Username.parse('alice'));
    const bob = await snapshots.find(Username.parse('bob'));
    db.close();

    expect(alice?.judgedBy).toEqual(SeedRule.of({ days: 14 }));
    expect(alice?.candidates).toHaveLength(1);
    expect(bob?.judgedBy).toEqual(SeedRule.of({ ratio: 1.5, days: 10 }));
  });

  it('should_word_a_list_from_before_judged_rules_after_the_default_when_no_admin_set_one', async () => {
    const old = boxBefore('0038_snapshot-judged-by');
    old
      .prepare("INSERT INTO cleanup_snapshots (username, taken_at) VALUES ('alice', '2026-11-02 09:00:00')")
      .run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const alice = await new SqliteCleanupSnapshotRepository(db).find(Username.parse('alice'));
    db.close();

    expect(alice?.judgedBy).toEqual(SeedRule.DEFAULT);
  });

  it('should_keep_the_identity_a_box_recorded_for_a_member_machine_under_its_new_name', () => {
    const old = boxBefore('0039_known-host-fingerprint');
    old
      .prepare(
        "INSERT INTO sync_destinations (username, host, port, account, sealed_password, path, last_check_fingerprint) VALUES ('alice', 'nas.example.org', 22, 'seedbox', 'sealed', '/volume1/torrents', 'SHA256:abc')",
      )
      .run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const row = db.raw
      .prepare("SELECT known_host_fingerprint FROM sync_destinations WHERE username = 'alice'")
      .get();
    db.close();

    expect(row).toEqual({ known_host_fingerprint: 'SHA256:abc' });
  });

  it('should_read_a_verdict_from_before_checks_put_transfers_back_as_having_put_none', async () => {
    const old = boxBefore('0040_check-requeued');
    old
      .prepare(
        "INSERT INTO sync_destinations (username, host, port, account, sealed_password, path, last_check_ok, last_check_at) VALUES ('alice', 'nas.example.org', 22, 'seedbox', 'sealed', '/volume1/torrents', 1, '2026-11-04 10:00:00')",
      )
      .run();
    old.close();

    const db = KoboxDatabase.open(join(dir, 'kobox.db'));
    const alice = await new SqliteSyncDestinationRepository(db).findByUsername(Username.parse('alice'));
    db.close();

    expect(alice?.lastCheck).toEqual({ ok: true, at: '2026-11-04 10:00:00' });
  });
});
