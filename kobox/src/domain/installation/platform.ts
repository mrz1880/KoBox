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
