import { describe, expect, it } from 'vitest';
import { Bandwidth } from '../../../../src/domain/security/Bandwidth.js';
import { FairUsePolicy } from '../../../../src/domain/security/FairUsePolicy.js';
import { ConnectionRate, EgressRate } from '../../../../src/domain/security/Rates.js';
import { InvalidThresholdError } from '../../../../src/domain/security/Threshold.js';

const defaults = FairUsePolicy.of({
  sustainedEgress: Bandwidth.mbit(50),
  maxAuthPerHour: 30,
  throttleTo: Bandwidth.mbit(5),
});

describe('FairUsePolicy', () => {
  it('should_reject_a_non_positive_auth_rate_limit', () => {
    expect(() =>
      FairUsePolicy.of({
        sustainedEgress: Bandwidth.mbit(50),
        maxAuthPerHour: 0,
        throttleTo: Bandwidth.mbit(5),
      }),
    ).toThrow(InvalidThresholdError);
  });

  it('should_produce_the_default_budget_without_overrides', () => {
    const budget = defaults.budgetFor();
    expect(budget.sustainedEgress.bps).toBe(50_000_000);
    expect(budget.maxAuthPerHour).toBe(30);
    expect(budget.throttleTo.bps).toBe(5_000_000);
  });

  it('should_let_per_user_overrides_win_field_by_field', () => {
    const budget = defaults.budgetFor({
      sustainedEgress: Bandwidth.mbit(100),
      maxAuthPerHour: 60,
    });
    expect(budget.sustainedEgress.bps).toBe(100_000_000);
    expect(budget.maxAuthPerHour).toBe(60);
    expect(budget.throttleTo.bps).toBe(5_000_000);
  });
});

describe('ResourceBudget', () => {
  const budget = defaults.budgetFor();

  it('should_detect_an_egress_breach', () => {
    expect(budget.isEgressBreach(EgressRate.fromDelta(600_000_000, 60))).toBe(true); // 80 Mbit/s
    expect(budget.isEgressBreach(EgressRate.fromDelta(60_000_000, 60))).toBe(false); // 8 Mbit/s
  });

  it('should_detect_an_abnormal_auth_rate', () => {
    expect(budget.isAuthBreach(ConnectionRate.perHour(82, 60))).toBe(true);
    expect(budget.isAuthBreach(ConnectionRate.perHour(12, 60))).toBe(false);
  });
});
