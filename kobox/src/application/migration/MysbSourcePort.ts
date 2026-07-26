import type {
  MysbAddressRow,
  MysbBlocklistRow,
  MysbTorrentRow,
  MysbTrackerRow,
  MysbUserRow,
} from './mysbSchemas.js';

// A user as seen from the MySB source: the central control-plane row plus the
// one datum that lives in the per-user sync sqlite (categories.sync_mode).
export interface MysbUser extends MysbUserRow {
  readonly syncDisabled: boolean;
}

// A tracker with its whitelisted IPv4 rows folded in (trackers_list 1:N
// trackers_list_ipv4).
export interface MysbTracker extends MysbTrackerRow {
  readonly ipv4: readonly string[];
}

export type MysbBlocklist = MysbBlocklistRow;
export type MysbTorrent = MysbTorrentRow;
export type MysbAddress = MysbAddressRow;

// Read-only view of a frozen MySB dump. Never a live connection — the caller
// supplies a directory of SQLite files copied read-only from the seedbox.
export interface MysbSource {
  users(): Promise<readonly MysbUser[]>;
  trackers(): Promise<readonly MysbTracker[]>;
  blocklists(): Promise<readonly MysbBlocklist[]>;
  torrents(): Promise<readonly MysbTorrent[]>;
  addresses(): Promise<readonly MysbAddress[]>;
}
