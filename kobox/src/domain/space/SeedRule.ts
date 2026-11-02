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

// What an admin may ask: below a tenth of the size given back a torrent would
// go almost at once, past a year it would never go. The job contract and the
// admin form read these bounds from here.
export const SEED_RULE_LIMITS = {
  ratio: { min: 0.1, max: 100 },
  days: { min: 1, max: 365 },
} as const;

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
    const { ratio, days } = SEED_RULE_LIMITS;
    // NaN fails both comparisons, so it is refused explicitly
    if (Number.isNaN(raw.ratio) || raw.ratio < ratio.min || raw.ratio > ratio.max) {
      throw new InvalidSeedRuleError(
        `ratio ${String(raw.ratio)} must be from ${String(ratio.min)} to ${String(ratio.max)}`,
      );
    }
    // whole days: the admin form asks for days, and a fraction would hide hours in it
    if (!Number.isInteger(raw.days) || raw.days < days.min || raw.days > days.max) {
      throw new InvalidSeedRuleError(
        `${String(raw.days)} days must be whole, from ${String(days.min)} to ${String(days.max)}`,
      );
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
