import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidQuotaError, Quota } from '../../../../src/domain/user/Quota.js';

describe('Quota', () => {
  it('should_store_bytes_and_convert_to_gib', () => {
    expect(Quota.bytes(0).toBytes()).toBe(0);
    expect(Quota.gib(1).toBytes()).toBe(1024 ** 3);
    expect(Quota.gib(412).toGib()).toBe(412);
  });

  it('should_reject_negative_and_non_integer_byte_counts', () => {
    for (const raw of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => Quota.bytes(raw)).toThrow(InvalidQuotaError);
    }
  });

  it('should_compare_by_value', () => {
    expect(Quota.gib(10).equals(Quota.bytes(10 * 1024 ** 3))).toBe(true);
    expect(Quota.gib(10).equals(Quota.gib(11))).toBe(false);
  });

  // Legacy bug #72: quota could not be raised above free disk space because the
  // space already used by the user was not counted.
  it('should_compute_max_settable_as_used_plus_free', () => {
    const max = Quota.maxSettable(Quota.gib(365), Quota.gib(1300));
    expect(max.toGib()).toBe(1665);
  });

  it('should_always_allow_a_user_to_keep_what_they_already_use', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 2 ** 48 }),
        fc.nat({ max: 2 ** 48 }),
        (used, free) => {
          const max = Quota.maxSettable(Quota.bytes(used), Quota.bytes(free));
          expect(max.toBytes()).toBeGreaterThanOrEqual(used);
        },
      ),
    );
  });

  it('should_tell_whether_a_requested_quota_fits', () => {
    const requested = Quota.gib(500);
    expect(requested.fitsWithin(Quota.maxSettable(Quota.gib(400), Quota.gib(50)))).toBe(false);
    expect(requested.fitsWithin(Quota.maxSettable(Quota.gib(400), Quota.gib(200)))).toBe(true);
  });
});
