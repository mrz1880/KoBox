import { DomainError } from '../shared/DomainError.js';

export class InvalidSeedRuleError extends DomainError {
  constructor(reason: string) {
    super(`invalid seed rule: ${reason}`);
  }
}

// What a box asks of a torrent before it may go, until an admin sets their own:
// twice what was downloaded given back, over at least a week.
const DEFAULT_RATIO = 2;
const DEFAULT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// The whole days a torrent seeded from when it finished until `now`, both ISO
// instants: a part day does not count.
export function wholeDaysSeeded(finishedAt: string, now: string): number {
  return Math.floor((Date.parse(now) - Date.parse(finishedAt)) / DAY_MS);
}

// When a finished torrent has seeded enough to be deleted: one rule for the
// whole box, both conditions required.
export class SeedRule {
  static readonly DEFAULT = new SeedRule(DEFAULT_RATIO, DEFAULT_DAYS);

  private constructor(
    readonly ratio: number,
    readonly days: number,
  ) {}

  static of(raw: { readonly ratio: number; readonly days: number }): SeedRule {
    if (!Number.isFinite(raw.ratio) || raw.ratio <= 0) {
      throw new InvalidSeedRuleError(`ratio ${String(raw.ratio)} must be above 0`);
    }
    // whole days: the admin form asks for days, and a fraction would hide hours in it
    if (!Number.isInteger(raw.days) || raw.days < 1) {
      throw new InvalidSeedRuleError(`${String(raw.days)} days must be at least one whole day`);
    }
    return new SeedRule(raw.ratio, raw.days);
  }

  isMetBy(
    torrent: { readonly ratio: number; readonly finishedAt: string },
    now: string,
  ): boolean {
    // whole days compare as the elapsed time would: the rule's days are whole
    return torrent.ratio >= this.ratio && wholeDaysSeeded(torrent.finishedAt, now) >= this.days;
  }
}
