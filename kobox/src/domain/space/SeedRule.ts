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

// What a rule may ask: below a tenth of the size given back a torrent would
// go almost at once, past a year it would never go. The job contracts and the
// forms read these bounds from here.
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

// When a finished torrent has seeded enough to be deleted: the days since it
// finished, and the ratio it gave back when a minimum one is asked. Without
// one, only the days count: a member may ask that for their own torrents.
export class SeedRule {
  static readonly DEFAULT: BoxSeedRule = SeedRule.of({ ratio: DEFAULT_RATIO, days: DEFAULT_DAYS });

  private constructor(
    readonly ratio: number | undefined,
    readonly days: number,
  ) {}

  // A rule given a ratio keeps it in its type: the box rule is one.
  static of(raw: { readonly ratio: number; readonly days: number }): BoxSeedRule;
  static of(raw: { readonly ratio?: number | undefined; readonly days: number }): SeedRule;
  static of(raw: { readonly ratio?: number | undefined; readonly days: number }): SeedRule {
    const { ratio, days } = SEED_RULE_LIMITS;
    // NaN fails both comparisons, so it is refused explicitly
    if (
      raw.ratio !== undefined &&
      (Number.isNaN(raw.ratio) || raw.ratio < ratio.min || raw.ratio > ratio.max)
    ) {
      throw new InvalidSeedRuleError(
        `ratio ${String(raw.ratio)} must be from ${String(ratio.min)} to ${String(ratio.max)}`,
      );
    }
    // whole days: the forms ask for days, and a fraction would hide hours in it
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
    const gaveBackEnough = this.ratio === undefined || torrent.ratio >= this.ratio;
    // whole days compare as the elapsed time would: the rule's days are whole
    return gaveBackEnough && wholeDaysSeeded(torrent.finishedAt, now) >= this.days;
  }
}

// The rule an admin sets for the whole box always asks a ratio: the members
// page requires one. Only a member's own rule may leave it out.
export type BoxSeedRule = SeedRule & { readonly ratio: number };
