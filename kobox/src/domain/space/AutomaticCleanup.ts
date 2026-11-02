import { DomainError } from '../shared/DomainError.js';
import type { CleanupCandidate, CleanupReason } from './CleanupCandidate.js';

export class InvalidAutomaticCleanupError extends DomainError {
  constructor(raw: string) {
    super(`invalid automatic cleanup choice ${JSON.stringify(raw)}`);
  }
}

// What KoBox may delete on its own once a member passes the critical line:
// nothing (the default), only what its own sync already put on the member's
// machine, or that and what seeded enough. KoBox only knows what its sync
// sent: a file fetched another way is invisible to it, hence the choice.
export const AUTOMATIC_CLEANUPS = ['off', 'sentOnly', 'sentOrSeeded'] as const;
export type AutomaticCleanup = (typeof AUTOMATIC_CLEANUPS)[number];

// The reasons each choice lets KoBox delete for: a record, so a new choice does
// not compile until someone decides what it may delete.
const DELETES_FOR: Readonly<Record<AutomaticCleanup, readonly CleanupReason[]>> = {
  off: [],
  sentOnly: ['alreadySent'],
  sentOrSeeded: ['alreadySent', 'seeded'],
};

export function parseAutomaticCleanup(raw: string): AutomaticCleanup {
  const match = AUTOMATIC_CLEANUPS.find((choice) => choice === raw);
  if (match === undefined) {
    throw new InvalidAutomaticCleanupError(raw);
  }
  return match;
}

// The candidates the member's choice lets KoBox delete without asking.
export function candidatesAllowedBy(
  automatic: AutomaticCleanup,
  candidates: readonly CleanupCandidate[],
): readonly CleanupCandidate[] {
  return candidates.filter((candidate) => DELETES_FOR[automatic].includes(candidate.reason));
}
