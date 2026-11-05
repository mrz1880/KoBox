import { DomainError } from '../shared/DomainError.js';
import type { WallClockHour } from './WallClockHour.js';

export class InvalidSendHourError extends DomainError {
  constructor(raw: number) {
    super(`invalid send hour ${String(raw)}: expected 0 to 23`);
  }
}

// The hour of day the "send it a bit later" folders go out. A member on a slow
// link picks the middle of the night on purpose, which is why this is a choice
// rather than a fixed interval: the legacy gave them the same choice through
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

  /**
   * Whether a scheduled pass running now takes this member on. The hour is
   * due once it has come round since the member's last scheduled pass, so a
   * pass that did not run at that hour (the worker down, a clock that skipped
   * it) is caught up by the next one, once. With no pass yet, only the hour
   * itself is due: saving a destination in the afternoon must not send at
   * once what the member chose to send at night.
   *
   * @param now the box's clock, at this pass
   * @param lastPass the scheduled pass before this one took this member on
   * @returns true when this member's queue goes out on this pass
   */
  isDueAt(now: WallClockHour, lastPass: WallClockHour | undefined): boolean {
    if (lastPass === undefined) {
      return now.hour === this.value;
    }
    return now.latestAt(this.value).isAfter(lastPass);
  }

  equals(other: SendHour): boolean {
    return this.value === other.value;
  }
}
