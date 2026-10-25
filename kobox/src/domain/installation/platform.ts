// The one Debian release KoBox installs on. Everything release-specific
// (the preflight, the apt sources, the PHP-FPM unit and socket) derives from
// here, so moving to the next release is a change in this file.
export const DEBIAN_RELEASE = { versionId: '13', codename: 'trixie' } as const;

// The PHP that release ships; ruTorrent and Nextcloud both run on its FPM pool.
const PHP_VERSION = '8.4';

export const PHP_FPM = {
  unit: `php${PHP_VERSION}-fpm`,
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
