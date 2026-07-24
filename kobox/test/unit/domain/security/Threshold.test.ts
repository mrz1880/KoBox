import { describe, expect, it } from 'vitest';
import { InvalidThresholdError, Threshold } from '../../../../src/domain/security/Threshold.js';

describe('Threshold', () => {
  it('should_be_exceeded_only_by_strictly_greater_values', () => {
    const limit = Threshold.of(30);
    expect(limit.isExceededBy(31)).toBe(true);
    expect(limit.isExceededBy(30)).toBe(false);
    expect(limit.isExceededBy(29)).toBe(false);
  });

  it('should_reject_negative_and_non_finite_limits', () => {
    for (const raw of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => Threshold.of(raw)).toThrow(InvalidThresholdError);
    }
  });
});
