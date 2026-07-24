import { DomainError } from '../shared/DomainError.js';

export class InvalidRateError extends DomainError {
  constructor(reason: string) {
    super(`invalid rate: ${reason}`);
  }
}

// Observed sustained egress over a sampling window (what the meter measured),
// as opposed to Bandwidth which is a configured limit.
export class EgressRate {
  private constructor(readonly bitsPerSecond: number) {}

  static fromDelta(bytes: number, seconds: number): EgressRate {
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new InvalidRateError(`byte delta must be >= 0, got ${String(bytes)}`);
    }
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new InvalidRateError(`window must be > 0 seconds, got ${String(seconds)}`);
    }
    return new EgressRate((bytes * 8) / seconds);
  }
}

// Observed connection/auth events normalized to a per-hour figure.
export class ConnectionRate {
  private constructor(readonly value: number) {}

  static perHour(count: number, windowMinutes: number): ConnectionRate {
    if (!Number.isFinite(count) || count < 0) {
      throw new InvalidRateError(`count must be >= 0, got ${String(count)}`);
    }
    if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
      throw new InvalidRateError(`window must be > 0 minutes, got ${String(windowMinutes)}`);
    }
    return new ConnectionRate((count * 60) / windowMinutes);
  }
}
