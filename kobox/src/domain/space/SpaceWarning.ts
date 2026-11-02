import type { QuotaPressure } from './QuotaPressure.js';

// Where the critical-line warning stands after one reading of the member's
// space: whether they count as warned from now on, and whether this reading is
// the one that warns them.
export interface SpaceWarningStep {
  readonly warned: boolean;
  readonly send: boolean;
}

// A member is warned once per climb: the first reading past the critical line
// warns, the next ones do not, and only going back under the filling line
// starts a new climb. Between the two lines nothing changes, so a member
// hovering around the critical line is not warned again and again.
export const SpaceWarning = {
  after(warned: boolean, pressure: QuotaPressure): SpaceWarningStep {
    switch (pressure) {
      case 'critical':
        return { warned: true, send: !warned };
      case 'filling':
        return { warned, send: false };
      case 'relaxed':
        return { warned: false, send: false };
    }
  },
};
