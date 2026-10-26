import type { Blocklist } from './Blocklist.js';

// Whether the blocklists protect anything yet, and if not, which step is
// missing: enabling lists (importing the catalog does) or downloading them.
export type BlocklistCoverage = 'no-list-enabled' | 'not-downloaded-yet' | 'blocking';

export function blocklistCoverage(lists: readonly Blocklist[]): BlocklistCoverage {
  const enabled = lists.filter((list) => list.enabled);
  if (enabled.length === 0) {
    return 'no-list-enabled';
  }
  return enabled.some((list) => list.lastUpdate?.status === 'ok')
    ? 'blocking'
    : 'not-downloaded-yet';
}
