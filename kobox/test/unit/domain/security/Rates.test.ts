import { describe, expect, it } from 'vitest';
import {
  ConnectionRate,
  EgressRate,
  InvalidRateError,
} from '../../../../src/domain/security/Rates.js';

describe('EgressRate', () => {
  it('should_compute_bits_per_second_from_a_byte_delta', () => {
    expect(EgressRate.fromDelta(75_000_000, 60).bitsPerSecond).toBe(10_000_000);
    expect(EgressRate.fromDelta(0, 60).bitsPerSecond).toBe(0);
  });

  it('should_reject_negative_deltas_and_non_positive_windows', () => {
    expect(() => EgressRate.fromDelta(-1, 60)).toThrow(InvalidRateError);
    expect(() => EgressRate.fromDelta(1000, 0)).toThrow(InvalidRateError);
    expect(() => EgressRate.fromDelta(1000, -5)).toThrow(InvalidRateError);
  });
});

describe('ConnectionRate', () => {
  it('should_normalize_a_windowed_count_to_per_hour', () => {
    expect(ConnectionRate.perHour(30, 60).value).toBe(30);
    expect(ConnectionRate.perHour(10, 30).value).toBe(20);
    // the user-h vector: 1979 connections/day ≈ 82/hour
    expect(ConnectionRate.perHour(1979, 24 * 60).value).toBeCloseTo(82.46, 1);
  });

  it('should_reject_negative_counts_and_non_positive_windows', () => {
    expect(() => ConnectionRate.perHour(-1, 60)).toThrow(InvalidRateError);
    expect(() => ConnectionRate.perHour(5, 0)).toThrow(InvalidRateError);
  });
});
