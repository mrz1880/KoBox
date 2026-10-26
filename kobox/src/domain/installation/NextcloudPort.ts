import type { Password } from '../user/Password.js';
import type { Username } from '../user/Username.js';

// The three folders a member expects at the root of their Nextcloud, and where
// each one really lives. Named after what they are rather than after the path,
// because the path is an implementation detail of this box.
export const NEXTCLOUD_MOUNTS: readonly { readonly label: string; readonly under: string }[] = [
  { label: 'rTorrent Complete', under: 'rtorrent/complete' },
  { label: 'rTorrent Torrents', under: 'rtorrent/torrents' },
  { label: 'rTorrent Watch', under: 'rtorrent/watch' },
];

// What Nextcloud's own admin page asks of a box, as occ system values.
export interface NextcloudSystemValue {
  readonly key: string;
  readonly value: string;
  readonly type: 'string' | 'integer';
}

export const NEXTCLOUD_SYSTEM_VALUES: readonly NextcloudSystemValue[] = [
  // a memory cache for one server: APCu, installed alongside
  { key: 'memcache.local', value: '\\OC\\Memcache\\APCu', type: 'string' },
  // heavy background jobs at 01:00 UTC rather than whenever
  { key: 'maintenance_window_start', value: '1', type: 'integer' },
  // phone numbers typed without +33 are French: the members are
  { key: 'default_phone_region', value: 'FR', type: 'string' },
];

// Shipped enabled, of no use here, and its admin warning is noise.
export const NEXTCLOUD_UNUSED_APPS: readonly string[] = ['app_api'];

// The server variable nginx fills with the member signed in to the portal, and
// the one Nextcloud opens sessions from. Nextcloud believes it without checking
// it, which is why it is named here once: nginx sets it, nothing else can.
export const PORTAL_USER_VARIABLE = 'KOBOX_PORTAL_USER';

// Everything here shells out to `occ`, which is Nextcloud's only supported
// non-interactive interface. It runs as the web user, never as root: occ
// refuses to run as root and would leave files nobody can read if it did.
export interface NextcloudPort {
  isInstalled(): Promise<boolean>;
  install(adminUser: string, adminPassword: string): Promise<void>;
  enableApp(app: string): Promise<void>;
  // an app that is not enabled is already where this leaves it
  disableApp(app: string): Promise<void>;
  setSystemValues(values: readonly NextcloudSystemValue[]): Promise<void>;
  // with the SSO app enabled: open the session of the member named in this
  // server variable, create no account, and keep Nextcloud's own sign-in page
  // for everyone else (its desktop and mobile apps included)
  trustPortalSignIn(variable: string): Promise<void>;
  // the public name and port it is reached on, under /nextcloud over HTTPS:
  // Nextcloud refuses any request whose host it was not told to trust
  serveAt(address: { readonly host: string; readonly port: number }): Promise<void>;
  hasUser(username: Username): Promise<boolean>;
  // creates the account on its first password, resets the password after that
  setUserPassword(username: Username, password: Password): Promise<void>;
  // deletes the account and the data Nextcloud itself holds for it; an account
  // that is already gone is not a failure
  deleteUser(username: Username): Promise<void>;
  setAdmin(username: Username, admin: boolean): Promise<void>;
  ensureLocalMount(username: Username, label: string, absolutePath: string): Promise<void>;
}
