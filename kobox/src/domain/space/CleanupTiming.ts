import { DomainError } from '../shared/DomainError.js';

export class InvalidCleanupTimingError extends DomainError {
  constructor(raw: string) {
    super(`invalid cleanup timing ${JSON.stringify(raw)}`);
  }
}

// When KoBox deletes on its own what a member's choice lets it delete: only
// once their space runs short (past the critical line, the default), or as
// soon as a torrent meets their seed rule, whatever space is left. A member
// who keeps two weeks and then deletes whatever the ratio wants the second.
export const CLEANUP_TIMINGS = ['whenSpaceRunsShort', 'onceRuleMet'] as const;
export type CleanupTiming = (typeof CLEANUP_TIMINGS)[number];

export function parseCleanupTiming(raw: string): CleanupTiming {
  const match = CLEANUP_TIMINGS.find((timing) => timing === raw);
  if (match === undefined) {
    throw new InvalidCleanupTimingError(raw);
  }
  return match;
}
