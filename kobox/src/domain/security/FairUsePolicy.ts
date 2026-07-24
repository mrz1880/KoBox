import type { Bandwidth } from './Bandwidth.js';
import type { ConnectionRate, EgressRate } from './Rates.js';
import { InvalidThresholdError, Threshold } from './Threshold.js';

export interface FairUseLimits {
  readonly sustainedEgress: Bandwidth;
  readonly maxAuthPerHour: number;
  readonly throttleTo: Bandwidth;
}

export interface FairUseOverrides {
  readonly sustainedEgress?: Bandwidth;
  readonly maxAuthPerHour?: number;
  readonly throttleTo?: Bandwidth;
}

// The per-user effective budget the evaluator judges against.
export class ResourceBudget {
  private readonly authThreshold: Threshold;

  constructor(
    readonly sustainedEgress: Bandwidth,
    readonly maxAuthPerHour: number,
    readonly throttleTo: Bandwidth,
  ) {
    this.authThreshold = Threshold.of(maxAuthPerHour);
  }

  isEgressBreach(rate: EgressRate): boolean {
    return this.sustainedEgress.isExceededBy(rate);
  }

  isAuthBreach(rate: ConnectionRate): boolean {
    return this.authThreshold.isExceededBy(rate.value);
  }
}

// The installation-wide default policy; per-user overrides win field by field.
export class FairUsePolicy {
  private constructor(private readonly limits: FairUseLimits) {}

  static of(limits: FairUseLimits): FairUsePolicy {
    if (!Number.isInteger(limits.maxAuthPerHour) || limits.maxAuthPerHour <= 0) {
      throw new InvalidThresholdError(limits.maxAuthPerHour);
    }
    return new FairUsePolicy(limits);
  }

  budgetFor(overrides?: FairUseOverrides): ResourceBudget {
    return new ResourceBudget(
      overrides?.sustainedEgress ?? this.limits.sustainedEgress,
      overrides?.maxAuthPerHour ?? this.limits.maxAuthPerHour,
      overrides?.throttleTo ?? this.limits.throttleTo,
    );
  }
}
