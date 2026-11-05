import { describe, expect, it } from 'vitest';
import { InvalidSendHourError, SendHour } from '../../../../src/domain/sync/SendHour.js';
import { WallClockHour } from '../../../../src/domain/sync/WallClockHour.js';

const at = (raw: string): WallClockHour => WallClockHour.parse(raw);

describe('SendHour', () => {
  it('should_accept_midnight_and_the_last_hour_of_the_day', () => {
    expect(SendHour.parse(0).value).toBe(0);
    expect(SendHour.parse(23).value).toBe(23);
  });

  it('should_refuse_an_hour_just_outside_the_day', () => {
    expect(() => SendHour.parse(-1)).toThrow(InvalidSendHourError);
    expect(() => SendHour.parse(24)).toThrow(InvalidSendHourError);
  });

  it('should_refuse_a_fractional_hour_and_name_it_in_the_error', () => {
    expect(() => SendHour.parse(2.5)).toThrow('invalid send hour 2.5: expected 0 to 23');
  });

  it('should_default_to_two_in_the_morning', () => {
    expect(SendHour.default().value).toBe(2);
  });

  // never passed yet: only its own hour, so a destination saved in the
  // afternoon does not send at once what the member chose to send at night
  it('should_be_due_only_at_its_own_hour_before_any_scheduled_pass', () => {
    const hour = SendHour.parse(3);

    expect(hour.isDueAt(at('2026-11-05 03'), undefined)).toBe(true);
    expect(hour.isDueAt(at('2026-11-05 04'), undefined)).toBe(false);
  });

  // the worker down at that hour must not cost the member a day: the next
  // pass catches up on the hour it missed, once
  it.each([
    ['its own hour, the pass before an hour earlier', 2, '2026-11-05 01', '2026-11-05 02', true],
    ['an hour late, the pass before missed it', 2, '2026-11-05 01', '2026-11-05 03', true],
    ['an hour late, it already went at its hour', 2, '2026-11-05 02', '2026-11-05 03', false],
    ['the same pass again within its hour', 2, '2026-11-05 02', '2026-11-05 02', false],
    ['days late', 2, '2026-11-02 01', '2026-11-05 10', true],
    ['not come yet today, went yesterday', 2, '2026-11-04 02', '2026-11-05 01', false],
    ['23:00 missed, caught up after midnight', 23, '2026-11-04 22', '2026-11-05 01', true],
    ['23:00 went, after midnight', 23, '2026-11-04 23', '2026-11-05 01', false],
    ['midnight, the pass before at 23:00', 0, '2026-11-04 23', '2026-11-05 00', true],
    ['midnight missed, caught up at 01:00', 0, '2026-11-04 23', '2026-11-05 01', true],
    ['midnight went', 0, '2026-11-05 00', '2026-11-05 01', false],
  ])('should_know_whether_it_is_due_%s', (_situation, hour, lastPass, now, due) => {
    expect(SendHour.parse(hour).isDueAt(at(now), at(lastPass))).toBe(due);
  });

  it('should_compare_by_value', () => {
    expect(SendHour.parse(3).equals(SendHour.parse(3))).toBe(true);
    expect(SendHour.parse(3).equals(SendHour.parse(4))).toBe(false);
  });
});
