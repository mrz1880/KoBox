import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-db-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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
    // a box that predates the VPN addresses: its schema stops at the migration
    // before them, with members already in it
    const before = join(dir, 'drizzle-before');
    cpSync('drizzle', before, { recursive: true });
    const journalPath = join(before, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    // everything from the VPN addresses on is still to come
    journal.entries = journal.entries.slice(
      0,
      journal.entries.findIndex((entry) => entry.tag === '0026_member-vpn-host'),
    );
    writeFileSync(journalPath, JSON.stringify(journal));
    const path = join(dir, 'kobox.db');
    const old = new Database(path);
    migrate(drizzle(old), { migrationsFolder: before });
    const insert = old.prepare(
      "INSERT INTO users (username, email, quota_bytes, scgi_port, rtorrent_port, proxy_port, status) VALUES (?, 'm@example.org', 1, ?, ?, 8080, 'active')",
    );
    insert.run('alice', 51101, 45000);
    insert.run('bob', 51102, 45001);
    insert.run('carol', 51103, 45002);
    old.close();

    const db = KoboxDatabase.open(path);
    const hosts = db.raw.prepare('SELECT username, vpn_host FROM users ORDER BY id').all();
    db.close();

    expect(hosts).toEqual([
      { username: 'alice', vpn_host: 2 },
      { username: 'bob', vpn_host: 3 },
      { username: 'carol', vpn_host: 4 },
    ]);
  });
});

