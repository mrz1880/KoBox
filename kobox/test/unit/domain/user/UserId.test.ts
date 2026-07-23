import { describe, expect, it } from 'vitest';
import { InvalidUserIdError, UserId } from '../../../../src/domain/user/UserId.js';

describe('UserId', () => {
  it('should_accept_positive_integers', () => {
    expect(UserId.parse(1).value).toBe(1);
    expect(UserId.parse(42).value).toBe(42);
  });

  it('should_reject_zero_negative_and_non_integers', () => {
    for (const raw of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => UserId.parse(raw)).toThrow(InvalidUserIdError);
    }
  });

  it('should_compare_by_value', () => {
    expect(UserId.parse(7).equals(UserId.parse(7))).toBe(true);
    expect(UserId.parse(7).equals(UserId.parse(8))).toBe(false);
  });
});
