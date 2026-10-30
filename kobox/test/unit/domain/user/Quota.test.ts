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

  it('should_tell_whether_a_requested_quota_fits', () => {
    const requested = Quota.gib(500);
    expect(requested.fitsWithin(Quota.gib(450))).toBe(false);
    expect(requested.fitsWithin(Quota.gib(500))).toBe(true);
    expect(requested.fitsWithin(Quota.gib(600))).toBe(true);
  });

  // what every member was promised together, to set against the disk
  it('should_add_up_to_the_total_of_several_amounts_and_to_nothing_for_none', () => {
    expect(Quota.total([Quota.gib(400), Quota.gib(400), Quota.gib(200)]).toGib()).toBe(1000);
    expect(Quota.total([]).toBytes()).toBe(0);
  });
});
