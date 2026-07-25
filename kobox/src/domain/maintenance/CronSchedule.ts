import { DomainError } from '../shared/DomainError.js';

export class InvalidCronScheduleError extends DomainError {
  constructor(raw: string, detail: string) {
    super(`invalid cron schedule ${JSON.stringify(raw)}: ${detail}`);
  }
}

interface FieldRange {
  readonly min: number;
  readonly max: number;
}

// minute, hour, day-of-month, month, day-of-week (0 and 7 = Sunday)
const FIELD_RANGES: readonly FieldRange[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
];

// Deliberately restricted grammar (no ranges, lists or names): every entry
// KoBox schedules is expressible as *, */n or a single number, and anything
// fancier in a root cron file is a smell, not a feature.
function checkField(raw: string, range: FieldRange): string | undefined {
  if (raw === '*') {
    return undefined;
  }
  const step = /^\*\/([0-9]{1,2})$/.exec(raw);
  if (step?.[1] !== undefined) {
    const n = Number(step[1]);
    if (n < 1 || n > range.max) {
      return `step ${raw} out of range`;
    }
    return undefined;
  }
  if (/^[0-9]{1,2}$/.test(raw)) {
    const n = Number(raw);
    if (n < range.min || n > range.max) {
      return `value ${raw} out of range [${String(range.min)}-${String(range.max)}]`;
    }
    return undefined;
  }
  return `field ${JSON.stringify(raw)} is not *, */n or a number`;
}

export class CronSchedule {
  private constructor(readonly value: string) {}

  static parse(raw: string): CronSchedule {
    const fields = raw.split(' ');
    if (fields.length !== FIELD_RANGES.length) {
      throw new InvalidCronScheduleError(raw, `expected 5 space-separated fields`);
    }
    for (const [index, range] of FIELD_RANGES.entries()) {
      const detail = checkField(fields[index] ?? '', range);
      if (detail !== undefined) {
        throw new InvalidCronScheduleError(raw, detail);
      }
    }
    return new CronSchedule(raw);
  }

  equals(other: CronSchedule): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
