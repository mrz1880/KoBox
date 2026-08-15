import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  MysbAddress,
  MysbBlocklist,
  MysbSource,
  MysbTorrent,
  MysbTracker,
  MysbUser,
} from '../../application/migration/MysbSourcePort.js';
import {
  mysbAddressSchema,
  mysbBlocklistSchema,
  mysbTorrentSchema,
  mysbTrackerIpv4Schema,
  mysbTrackerRowSchema,
  mysbUserSchema,
} from '../../application/migration/mysbSchemas.js';

const categoryRowSchema = z.object({ name: z.string(), sync_mode: z.number().int() });

// Reads a frozen MySB dump directory: `mysb.sqlite` (control-plane tables
// mirrored from MariaDB) plus `sync/<user>.sq3` (the per-user sync sqlite copied
// verbatim). Opened read-only — this adapter never mutates the source.
export class SqliteMysbDumpSource implements MysbSource {
  private readonly db: Database.Database;

  constructor(private readonly dumpDir: string) {
    const dbPath = join(dumpDir, 'mysb.sqlite');
    if (!existsSync(dbPath)) {
      throw new Error(`MySB dump database not found: ${dbPath}`);
    }
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
  }

  users(): Promise<readonly MysbUser[]> {
    const rows = this.db
      .prepare(
        'SELECT username, email, scgi_port, rtorrent_port, proxy_port, quota_bytes, account_type, active FROM users',
      )
      .all();
    const users = rows.map((row): MysbUser => {
      const dto = mysbUserSchema.parse(row);
      const categories = this.readCategories(dto.username);
      // A member counts as sync-disabled only when EVERY category is 0 — the
      // legacy meaning, and it must stay derived from the same rows.
      const syncDisabled = categories.length > 0 && categories.every((c) => c.syncMode === 0);
      return { ...dto, syncDisabled, categories };
    });
    return Promise.resolve(users);
  }

  trackers(): Promise<readonly MysbTracker[]> {
    const trackerRows = this.db
      .prepare('SELECT host, proto, port, privacy, is_active, is_dead, is_ssl FROM trackers_list')
      .all();
    const ipv4Rows = this.db
      .prepare('SELECT host, ipv4 FROM trackers_list_ipv4')
      .all();

    const ipv4ByHost = new Map<string, string[]>();
    for (const raw of ipv4Rows) {
      const row = mysbTrackerIpv4Schema.parse(raw);
      const list = ipv4ByHost.get(row.host) ?? [];
      list.push(row.ipv4);
      ipv4ByHost.set(row.host, list);
    }

    const trackers = trackerRows.map((raw): MysbTracker => {
      const dto = mysbTrackerRowSchema.parse(raw);
      return { ...dto, ipv4: ipv4ByHost.get(dto.host) ?? [] };
    });
    return Promise.resolve(trackers);
  }

  blocklists(): Promise<readonly MysbBlocklist[]> {
    const rows = this.db
      .prepare('SELECT source, author, name, url, subscription, enabled FROM blocklists')
      .all();
    return Promise.resolve(rows.map((row) => mysbBlocklistSchema.parse(row)));
  }

  torrents(): Promise<readonly MysbTorrent[]> {
    const rows = this.db
      .prepare('SELECT username, info_hash, name, label, state FROM torrents')
      .all();
    return Promise.resolve(rows.map((row) => mysbTorrentSchema.parse(row)));
  }

  addresses(): Promise<readonly MysbAddress[]> {
    const rows = this.db
      .prepare('SELECT username, value, kind FROM user_addresses')
      .all();
    return Promise.resolve(rows.map((row) => mysbAddressSchema.parse(row)));
  }

  close(): void {
    this.db.close();
  }

  // The single datum from the per-user sync sqlite: the user counts as "sync
  // disabled" only when every category is off (sync_mode = 0). A missing file
  // (a user who never synced) defaults to not-disabled.
  // The member's folders, straight out of their own sync sqlite. Only this table
  // is read: the same file holds `ident`, whose password column is the one thing
  // in a MySB dump nobody should be opening.
  private readCategories(username: string): { name: string; syncMode: number }[] {
    const syncPath = join(this.dumpDir, 'sync', `${username}.sq3`);
    if (!existsSync(syncPath)) {
      return [];
    }
    const sync = new Database(syncPath, { readonly: true, fileMustExist: true });
    try {
      return sync
        .prepare('SELECT name, sync_mode FROM categories')
        .all()
        .map((row) => {
          const parsed = categoryRowSchema.parse(row);
          return { name: parsed.name, syncMode: parsed.sync_mode };
        });
    } finally {
      sync.close();
    }
  }
}
