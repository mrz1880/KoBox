import type { StalledHashCheckPass } from '../application/torrent/RestartStalledHashChecks.js';
import type { PassWarning } from './diskUsagePassWarnings.js';

// What a pass over the members' hash queues tells the operator: each download
// it restarted, since the cause of the stall is not known yet and every one
// of them is a clue, and each rTorrent it could not ask.
export function stalledHashCheckWarnings(pass: StalledHashCheckPass): readonly PassWarning[] {
  return [
    ...pass.restarted.map((download) => ({
      message: 'hash queue stalled: download restarted',
      context: { username: download.username.value, infoHash: download.infoHash.value },
    })),
    ...pass.unreadable.map((member) => ({
      message: 'hash queue: rtorrent not asked',
      context: { username: member.username.value, error: member.error },
    })),
  ];
}
