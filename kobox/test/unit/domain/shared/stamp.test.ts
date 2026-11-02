import { describe, expect, it } from 'vitest';
import { instantOf, shiftStamp, stampOf } from '../../../../src/domain/shared/stamp.js';

describe('stamp', () => {
  it('should_write_a_date_as_utc_to_the_second', () => {
    expect(stampOf(new Date('2026-10-26T09:05:07.892Z'))).toBe('2026-10-26 09:05:07');
  });

  it('should_move_a_stamp_forward_or_back_by_milliseconds', () => {
    expect(shiftStamp('2026-10-26 23:50:00', 15 * 60_000)).toBe('2026-10-27 00:05:00');
    expect(shiftStamp('2026-10-26 00:30:00', -60 * 60_000)).toBe('2026-10-25 23:30:00');
  });

  // a stamp carries no zone: it is UTC, whatever zone the box runs in
  it('should_give_the_utc_instant_a_stamp_stands_for', () => {
    expect(instantOf('2026-11-02 10:00:00')).toBe('2026-11-02T10:00:00.000Z');
  });
});
