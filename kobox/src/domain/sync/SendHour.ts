import { DomainError } from '../shared/DomainError.js';

export class InvalidSendHourError extends DomainError {
  constructor(raw: number) {
    super(`invalid send hour ${String(raw)}: expected 0 to 23`);
  }
}

// The hour of day the "send it a bit later" folders go out. A member on a slow
// link picks the middle of the night on purpose, which is why this is a choice
// rather than a fixed interval — the legacy gave them the same choice through
// their own crontab.
//
// KoBox never writes a per-member crontab for it: one hourly system pass takes
// on whichever members' hour has come.
export class SendHour {
  private constructor(readonly value: number) {}

  static parse(raw: number): SendHour {
    if (!Number.isInteger(raw) || raw < 0 || raw > 23) {
      throw new InvalidSendHourError(raw);
    }
    return new SendHour(raw);
  }

  // Quiet by default: the small hours are when a home link is idle.
  static default(): SendHour {
    return new SendHour(2);
  }

  hasCome(currentHour: number): boolean {
    return this.value === currentHour;
  }

  equals(other: SendHour): boolean {
    return this.value === other.value;
  }
}
