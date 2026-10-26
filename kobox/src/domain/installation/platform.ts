// The one Debian release KoBox installs on. Everything release-specific
// (the preflight, the apt sources, the PHP-FPM unit and socket) derives from
// here, so moving to the next release is a change in this file.
export const DEBIAN_RELEASE = { versionId: '13', codename: 'trixie' } as const;

// The PHP that release ships; ruTorrent and Nextcloud both run on its FPM pool.
const PHP_VERSION = '8.4';

// KoBox's own PHP settings, beside Debian's, so a package upgrade never
// rewrites them. The pool file sorts last to override the stock www pool.
export const PHP_SETTINGS = {
  fpm: `/etc/php/${PHP_VERSION}/fpm/conf.d/90-kobox.ini`,
  cli: `/etc/php/${PHP_VERSION}/cli/conf.d/90-kobox.ini`,
  pool: `/etc/php/${PHP_VERSION}/fpm/pool.d/zz-kobox.conf`,
} as const;

// One PHP pool per member for ruTorrent, running as that member: the web
// server, in every member's group for Nextcloud, no longer runs ruTorrent.
export const RUTORRENT_POOL_PREFIX = 'kobox-ru-';
export const RUTORRENT_POOL_DIR = `/etc/php/${PHP_VERSION}/fpm/pool.d`;
export function rutorrentPoolSocket(member: string): string {
  return `/run/php/${RUTORRENT_POOL_PREFIX}${member}.sock`;
}

export const PHP_FPM = {
  unit: `php${PHP_VERSION}-fpm`,
  binary: `php-fpm${PHP_VERSION}`,
  socket: `/run/php/php${PHP_VERSION}-fpm.sock`,
} as const;

// The account nginx and PHP-FPM run as: what serves ruTorrent, Nextcloud and
// the media a member streams, and so what has to reach into member trees.
export const WEB_SERVER_USER = 'www-data';

// Where the vendored ruTorrent release is extracted and served from.
export const RUTORRENT_DIR = '/var/www/rutorrent';

// Every member's system account is in this group: what all members, and only
// them, may reach.
export const MEMBERS_GROUP = 'kobox-users';
