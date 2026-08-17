import type { Username } from '../user/Username.js';

// The three folders a member expects at the root of their Nextcloud, and where
// each one really lives. Named after what they are rather than after the path,
// because the path is an implementation detail of this box.
export const NEXTCLOUD_MOUNTS: readonly { readonly label: string; readonly under: string }[] = [
  { label: 'rTorrent Complete', under: 'rtorrent/complete' },
  { label: 'rTorrent Torrents', under: 'rtorrent/torrents' },
  { label: 'rTorrent Watch', under: 'rtorrent/watch' },
];

// Everything here shells out to `occ`, which is Nextcloud's only supported
// non-interactive interface. It runs as the web user, never as root: occ
// refuses to run as root and would leave files nobody can read if it did.
export interface NextcloudPort {
  isInstalled(): Promise<boolean>;
  install(adminUser: string, adminPassword: string): Promise<void>;
  enableApp(app: string): Promise<void>;
  // idempotent: creating a member who exists is a no-op, not a failure
  ensureUser(username: Username, password: string): Promise<void>;
  // deletes the account and the data Nextcloud itself holds for it. KoBox
  // removes a deleted member's home with userdel -r, so leaving the account
  // would leave an orphan nobody administers.
  deleteUser(username: Username): Promise<void>;
  setAdmin(username: Username, admin: boolean): Promise<void>;
  ensureLocalMount(username: Username, label: string, absolutePath: string): Promise<void>;
}
