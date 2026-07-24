import { DomainError } from '../shared/DomainError.js';

export class InvalidThresholdError extends DomainError {
  constructor(raw: number) {
    super(`invalid threshold ${String(raw)}: must be a finite non-negative number`);
  }
}

export class Threshold {
  private constructor(readonly limit: number) {}

  static of(limit: number): Threshold {
    if (!Number.isFinite(limit) || limit < 0) {
      throw new InvalidThresholdError(limit);
    }
    return new Threshold(limit);
  }

  isExceededBy(observed: number): boolean {
    return observed > this.limit;
  }
}
