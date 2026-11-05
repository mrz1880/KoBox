import { DomainError } from '../shared/DomainError.js';

export class InvalidWallClockHourError extends DomainError {
  constructor(raw: string) {
    super(`invalid wall-clock hour ${JSON.stringify(raw)}: expected YYYY-MM-DD HH`);
  }
}

// "2026-11-05 02": the day, a space, the hour on two digits. Written this way,
// two hours compare in the order they came.
const PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})$/;
const HOURS_IN_A_DAY = 24;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * An hour of a day as the box's own clock shows it: the hour a member picks to
 * send at is one of those, not a UTC one. Immutable, compared by value.
 */
export class WallClockHour {
  private constructor(
    // the calendar day, as midnight UTC of that date: date arithmetic only,
    // the zone is the box's and is already applied
    private readonly day: Date,
    readonly hour: number,
  ) {}

  /**
   * @param raw an hour written as "YYYY-MM-DD HH"
   * @returns that hour
   * @throws InvalidWallClockHourError when it is not an hour of a real day
   */
  static parse(raw: string): WallClockHour {
    const match = PATTERN.exec(raw);
    if (match === null) {
      throw new InvalidWallClockHourError(raw);
    }
    const [year, month, date, hour] = match.slice(1).map(Number);
    if (year === undefined || month === undefined || date === undefined || hour === undefined) {
      throw new InvalidWallClockHourError(raw);
    }
    const day = new Date(Date.UTC(year, month - 1, date));
    const isRealDay = day.getUTCMonth() === month - 1 && day.getUTCDate() === date;
    if (!isRealDay || hour >= HOURS_IN_A_DAY) {
      throw new InvalidWallClockHourError(raw);
    }
    return new WallClockHour(day, hour);
  }

  /** The hour written as "YYYY-MM-DD HH", read back by parse. */
  get value(): string {
    return `${this.day.toISOString().slice(0, 10)} ${twoDigits(this.hour)}`;
  }

  /**
   * @param hour an hour of the day, 0 to 23
   * @returns the last time the clock showed that hour, this one included
   */
  latestAt(hour: number): WallClockHour {
    const day = hour <= this.hour ? this.day : new Date(this.day.getTime() - MS_PER_DAY);
    return new WallClockHour(day, hour);
  }

  isAfter(other: WallClockHour): boolean {
    return this.value > other.value;
  }

  equals(other: WallClockHour): boolean {
    return this.value === other.value;
  }
}
