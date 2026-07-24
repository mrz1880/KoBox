import { describe, expect, it } from 'vitest';
import { Bandwidth, InvalidBandwidthError } from '../../../../src/domain/security/Bandwidth.js';
import { EgressRate } from '../../../../src/domain/security/Rates.js';

describe('Bandwidth', () => {
  it('should_store_bits_per_second_and_convert_from_mbit', () => {
    expect(Bandwidth.bitsPerSecond(500_000).bps).toBe(500_000);
    expect(Bandwidth.mbit(50).bps).toBe(50_000_000);
  });

  it('should_reject_zero_negative_and_non_integer_rates', () => {
    for (const raw of [0, -8, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => Bandwidth.bitsPerSecond(raw)).toThrow(InvalidBandwidthError);
    }
  });

  it('should_render_a_tc_safe_integer_kbit_rate', () => {
    expect(Bandwidth.mbit(8).toTcRate()).toBe('8000kbit');
    expect(Bandwidth.bitsPerSecond(1_500).toTcRate()).toBe('2kbit');
    // tc rejects a zero rate: the floor is 1kbit
    expect(Bandwidth.bitsPerSecond(100).toTcRate()).toBe('1kbit');
  });

  it('should_tell_whether_an_observed_egress_rate_exceeds_it', () => {
    const limit = Bandwidth.mbit(10);
    expect(limit.isExceededBy(EgressRate.fromDelta(150_000_000, 60))).toBe(true); // 20 Mbit/s
    expect(limit.isExceededBy(EgressRate.fromDelta(30_000_000, 60))).toBe(false); // 4 Mbit/s
  });

  it('should_compare_by_value', () => {
    expect(Bandwidth.mbit(1).equals(Bandwidth.bitsPerSecond(1_000_000))).toBe(true);
    expect(Bandwidth.mbit(1).equals(Bandwidth.mbit(2))).toBe(false);
  });
});
