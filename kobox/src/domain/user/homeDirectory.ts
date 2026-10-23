import type { Username } from './Username.js';

// Where members' system accounts live. The account is created with this home
// explicitly, so everything that reaches into it (rTorrent, Nextcloud, nginx,
// the portal) derives its paths from here rather than from the distribution's
// useradd default.
export const HOME_BASE = '/home';

export function homeOf(username: Username): string {
  return `${HOME_BASE}/${username.value}`;
}
