import { describe, expect, it } from 'vitest';
import { InvalidSeedRuleError, SeedRule } from '../../../../src/domain/space/SeedRule.js';

describe('SeedRule', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'should_refuse_a_ratio_that_is_not_above_zero_%s',
    (ratio) => {
      expect(() => SeedRule.of({ ratio, days: 7 })).toThrow(InvalidSeedRuleError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])('should_refuse_fewer_than_one_whole_day_%s', (days) => {
    expect(() => SeedRule.of({ ratio: 2, days })).toThrow(InvalidSeedRuleError);
  });

  it('should_ask_a_ratio_of_two_over_a_week_by_default', () => {
    expect(SeedRule.DEFAULT.ratio).toBe(2);
    expect(SeedRule.DEFAULT.days).toBe(7);
  });

  describe('isMetBy', () => {
    const now = '2026-11-09T12:00:00.000Z';
    const rule = SeedRule.of({ ratio: 2, days: 7 });

    it('should_be_met_by_the_ratio_asked_reached_exactly_the_days_asked_ago', () => {
      expect(rule.isMetBy({ ratio: 2, finishedAt: '2026-11-02T12:00:00.000Z' }, now)).toBe(true);
    });

    it('should_not_be_met_just_below_the_ratio_asked', () => {
      expect(rule.isMetBy({ ratio: 1.99, finishedAt: '2026-11-02T12:00:00.000Z' }, now)).toBe(
        false,
      );
    });

    it('should_not_be_met_an_hour_before_the_days_asked_have_passed', () => {
      expect(rule.isMetBy({ ratio: 5, finishedAt: '2026-11-02T13:00:00.000Z' }, now)).toBe(false);
    });
  });
});
