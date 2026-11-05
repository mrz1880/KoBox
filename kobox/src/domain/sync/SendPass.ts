import type { Username } from '../user/Username.js';

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
