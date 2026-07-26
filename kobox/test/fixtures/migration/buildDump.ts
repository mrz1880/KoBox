import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Builds a NEUTRAL MySB dump directory for tests (repo is public — only RFC
// 2606 domains, RFC 5737 IPs, placeholder usernames). The schema written here
// IS the documented dump contract that CUTOVER.md's export recipe must produce.

export interface DumpUserSpec {
  readonly username: string;
  readonly email: string;
  readonly scgiPort: number;
  readonly rtorrentPort: number;
  readonly proxyPort?: number;
  readonly quotaBytes?: number;
  readonly accountType?: 'normal' | 'plex';
  readonly active?: 0 | 1;
  // per-category sync_mode values written to sync/<username>.sq3 (omit for no file)
  readonly syncMode?: readonly number[];
}

export interface DumpTrackerSpec {
  readonly host: string;
  readonly proto: 'http' | 'https' | 'udp';
  readonly port: number;
  readonly privacy: 'public' | 'private';
  readonly isActive?: 0 | 1;
  readonly isDead?: 0 | 1;
  readonly isSsl?: 0 | 1;
  readonly ipv4?: readonly string[];
}

export interface DumpBlocklistSpec {
  readonly source: 'iblocklist' | 'personal';
  readonly author: string;
  readonly name: string;
  readonly url: string;
  readonly subscription?: 0 | 1;
  readonly enabled?: 0 | 1;
}

export interface DumpTorrentSpec {
  readonly username: string;
  readonly infoHash: string;
  readonly name: string;
  readonly label?: string | null;
  readonly state: 'loaded' | 'completed' | 'rejected';
}

export interface DumpAddressSpec {
  readonly username: string;
  readonly value: string;
  readonly kind: 'ipv4' | 'hostname';
}

export interface DumpSpec {
  readonly users: readonly DumpUserSpec[];
  readonly trackers?: readonly DumpTrackerSpec[];
  readonly blocklists?: readonly DumpBlocklistSpec[];
  readonly torrents?: readonly DumpTorrentSpec[];
  readonly addresses?: readonly DumpAddressSpec[];
}

const SCHEMA = `
CREATE TABLE users (
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  scgi_port INTEGER NOT NULL,
  rtorrent_port INTEGER NOT NULL,
  proxy_port INTEGER NOT NULL,
  quota_bytes INTEGER NOT NULL,
  account_type TEXT NOT NULL,
  active INTEGER NOT NULL
);
CREATE TABLE trackers_list (
  host TEXT NOT NULL,
  proto TEXT NOT NULL,
  port INTEGER NOT NULL,
  privacy TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  is_dead INTEGER NOT NULL,
  is_ssl INTEGER NOT NULL
);
CREATE TABLE trackers_list_ipv4 (host TEXT NOT NULL, ipv4 TEXT NOT NULL);
CREATE TABLE blocklists (
  source TEXT NOT NULL,
  author TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  subscription INTEGER NOT NULL,
  enabled INTEGER NOT NULL
);
CREATE TABLE torrents (
  username TEXT NOT NULL,
  info_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT,
  state TEXT NOT NULL
);
CREATE TABLE user_addresses (username TEXT NOT NULL, value TEXT NOT NULL, kind TEXT NOT NULL);
`;

export function buildDump(spec: DumpSpec): string {
  const dir = mkdtempSync(join(tmpdir(), 'kobox-mysb-dump-'));
  const db = new Database(join(dir, 'mysb.sqlite'));
  db.exec(SCHEMA);

  const insertUser = db.prepare(
    'INSERT INTO users (username, email, scgi_port, rtorrent_port, proxy_port, quota_bytes, account_type, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const u of spec.users) {
    insertUser.run(
      u.username,
      u.email,
      u.scgiPort,
      u.rtorrentPort,
      u.proxyPort ?? 8080,
      u.quotaBytes ?? 442_381_107_200,
      u.accountType ?? 'normal',
      u.active ?? 1,
    );
  }

  const insertTracker = db.prepare(
    'INSERT INTO trackers_list (host, proto, port, privacy, is_active, is_dead, is_ssl) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertIpv4 = db.prepare('INSERT INTO trackers_list_ipv4 (host, ipv4) VALUES (?, ?)');
  for (const t of spec.trackers ?? []) {
    insertTracker.run(t.host, t.proto, t.port, t.privacy, t.isActive ?? 1, t.isDead ?? 0, t.isSsl ?? 1);
    for (const ip of t.ipv4 ?? []) {
      insertIpv4.run(t.host, ip);
    }
  }

  const insertBlocklist = db.prepare(
    'INSERT INTO blocklists (source, author, name, url, subscription, enabled) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const b of spec.blocklists ?? []) {
    insertBlocklist.run(b.source, b.author, b.name, b.url, b.subscription ?? 1, b.enabled ?? 1);
  }

  const insertTorrent = db.prepare(
    'INSERT INTO torrents (username, info_hash, name, label, state) VALUES (?, ?, ?, ?, ?)',
  );
  for (const t of spec.torrents ?? []) {
    insertTorrent.run(t.username, t.infoHash, t.name, t.label ?? null, t.state);
  }

  const insertAddress = db.prepare(
    'INSERT INTO user_addresses (username, value, kind) VALUES (?, ?, ?)',
  );
  for (const a of spec.addresses ?? []) {
    insertAddress.run(a.username, a.value, a.kind);
  }

  db.close();

  mkdirSync(join(dir, 'sync'));
  for (const u of spec.users) {
    if (u.syncMode === undefined) {
      continue;
    }
    const sync = new Database(join(dir, 'sync', `${u.username}.sq3`));
    sync.exec('CREATE TABLE categories (name TEXT, sync_mode INTEGER)');
    const insertCategory = sync.prepare('INSERT INTO categories (name, sync_mode) VALUES (?, ?)');
    u.syncMode.forEach((mode, index) => insertCategory.run(`category-${String(index)}`, mode));
    sync.close();
  }

  return dir;
}
