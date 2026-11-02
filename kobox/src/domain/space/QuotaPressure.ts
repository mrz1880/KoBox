import { Quota } from '../user/Quota.js';

// From this share of their allowance a member is told what they can clean.
const FILLING_FROM = 0.8;
// From this share rTorrent is close to failing to write: the member gets a
// mail, or the cleanup runs on its own if they opted in.
const CRITICAL_FROM = 0.9;

// How close a member is to their allowance: under the filling line, between
// the two lines, or past the critical one.
export type QuotaPressure = 'relaxed' | 'filling' | 'critical';

// The usage at a given share of the allowance, rounded down to a whole byte.
function shareOf(allowance: Quota, fraction: number): Quota {
  return Quota.bytes(Math.floor(allowance.toBytes() * fraction));
}

function reaches(used: Quota, line: Quota): boolean {
  return line.fitsWithin(used);
}

export const QuotaPressure = {
  of(used: Quota, allowance: Quota): QuotaPressure {
    if (reaches(used, shareOf(allowance, CRITICAL_FROM))) {
      return 'critical';
    }
    return reaches(used, QuotaPressure.targetUsage(allowance)) ? 'filling' : 'relaxed';
  },

  // The usage a cleanup brings a member back to: the line where filling starts.
  targetUsage(allowance: Quota): Quota {
    return shareOf(allowance, FILLING_FROM);
  },
};
