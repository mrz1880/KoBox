import { DomainError } from '../shared/DomainError.js';
import type { EgressRate } from './Rates.js';

export class InvalidBandwidthError extends DomainError {
  constructor(raw: number) {
    super(`invalid bandwidth ${String(raw)}: must be a positive integer bit/s count`);
  }
}

// A configured rate limit (fair-use ceiling, throttle target), in bits per
// second — the unit tc and the fair-use policy share.
export class Bandwidth {
  private constructor(readonly bps: number) {}

  static bitsPerSecond(raw: number): Bandwidth {
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new InvalidBandwidthError(raw);
    }
    return new Bandwidth(raw);
  }

  static mbit(raw: number): Bandwidth {
    return Bandwidth.bitsPerSecond(raw * 1_000_000);
  }

  // tc rejects fractional and zero rates: integer kbit with a 1kbit floor.
  toTcRate(): string {
    return `${String(Math.max(1, Math.round(this.bps / 1000)))}kbit`;
  }

  isExceededBy(rate: EgressRate): boolean {
    return rate.bitsPerSecond > this.bps;
  }

  equals(other: Bandwidth): boolean {
    return this.bps === other.bps;
  }
}
