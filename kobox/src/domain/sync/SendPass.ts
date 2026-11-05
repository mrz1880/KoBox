import type { TorrentInstance } from '../torrent/TorrentInstance.js';
import type { Username } from '../user/Username.js';
import { departureOf } from './Departure.js';
import type { SyncTransfer } from './SyncTransfer.js';

// One pass over the transfer queue.
//
// - scheduled: the hourly pass, which takes on every member whose send hour
//   has come (see SendHour.isDueAt).
// - immediate: one member's pass, run now whatever the hour, because something
//   of theirs is to leave at once.
export type SendPass =
  | { readonly kind: 'scheduled' }
  | { readonly kind: 'immediate'; readonly member: Username };

export const SCHEDULED_PASS: SendPass = { kind: 'scheduled' };

export function immediatePassFor(member: Username): SendPass {
  return { kind: 'immediate', member };
}

/**
 * Which of a member's waiting transfers this pass carries. The scheduled pass,
 * once the member's hour has come, carries everything that waits. An
 * immediate pass carries only what leaves straight away (see Departure): a
 * finished download, a "Try again" or a working check in one folder must not
 * drag out what the member chose to keep for their hour.
 *
 * @param pass the pass running now
 * @param waiting the member's waiting transfers, oldest first
 * @param folders the member's folders and how each one sends, if any
 * @returns the transfers this pass sends, in the order they waited
 */
export function carriedBy(
  pass: SendPass,
  waiting: readonly SyncTransfer[],
  folders: TorrentInstance | undefined,
): readonly SyncTransfer[] {
  switch (pass.kind) {
    case 'scheduled':
      return waiting;
    case 'immediate':
      return waiting.filter(
        (transfer) => departureOf(folders, transfer.label) === 'straight-away',
      );
  }
}
