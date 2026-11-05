import { describe, expect, it } from 'vitest';
import {
  InvalidWallClockHourError,
  WallClockHour,
} from '../../../../src/domain/sync/WallClockHour.js';

describe('WallClockHour', () => {
  it('should_read_back_the_hour_it_was_written_as', () => {
    expect(WallClockHour.parse('2026-11-05 02').value).toBe('2026-11-05 02');
  });

  it('should_refuse_what_is_not_an_hour_of_a_real_day', () => {
    for (const raw of ['2026-11-05 24', '2026-02-30 02', '2026-11-05', '2026-11-05 2']) {
      expect(() => WallClockHour.parse(raw)).toThrow(InvalidWallClockHourError);
    }
  });

  // the last time the clock showed that hour, this one included
  it('should_find_the_last_time_an_hour_came_round', () => {
    const now = WallClockHour.parse('2026-11-05 03');

    expect(now.latestAt(2).value).toBe('2026-11-05 02');
    expect(now.latestAt(3).value).toBe('2026-11-05 03');
    expect(now.latestAt(23).value).toBe('2026-11-04 23');
  });

  it('should_go_back_across_a_month_and_a_year', () => {
    expect(WallClockHour.parse('2026-03-01 00').latestAt(23).value).toBe('2026-02-28 23');
    expect(WallClockHour.parse('2027-01-01 01').latestAt(2).value).toBe('2026-12-31 02');
  });

  it('should_tell_which_of_two_hours_came_later', () => {
    const earlier = WallClockHour.parse('2026-11-04 23');
    const later = WallClockHour.parse('2026-11-05 00');

    expect([later.isAfter(earlier), earlier.isAfter(later), later.isAfter(later)]).toEqual([
      true,
      false,
      false,
    ]);
  });
});
