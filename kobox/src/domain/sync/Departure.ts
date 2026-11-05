import type { Label } from '../torrent/Label.js';
import type { TorrentInstance } from '../torrent/TorrentInstance.js';

// When a transfer leaves for the member's machine: on a pass of its own right
// now, or on the hourly pass once the member's send hour has come.
export type Departure = 'straight-away' | 'at-send-hour';

// A waiting transfer, just queued or put back, goes out the way its folder
// sends now: at once for a folder that sends straight away, at the member's
// hour otherwise. It decides what a member's immediate pass carries (see
// SendPass), and what the page promises after a "Try again".
//
// Anything short of a folder that still says "straight away" (a scheduled one,
// one set to stay here since, one renamed or removed, a member with no folders)
// waits for the hour. The hourly pass always comes, so the transfer is never
// stranded, while an unasked immediate send would load the link at a time the
// member chose to keep free.
export function departureOf(
  folders: TorrentInstance | undefined,
  label: Label,
): Departure {
  return folders?.sendsStraightAway(label) === true ? 'straight-away' : 'at-send-hour';
}
