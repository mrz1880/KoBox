// The one Debian release KoBox installs on. Everything release-specific
// (the preflight, the apt sources, the PHP-FPM unit and socket) derives from
// here, so moving to the next release is a change in this file.
export const DEBIAN_RELEASE = { versionId: '13', codename: 'trixie' } as const;
