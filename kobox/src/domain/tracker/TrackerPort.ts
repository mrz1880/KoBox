import { DomainError } from '../shared/DomainError.js';

export class InvalidPortError extends DomainError {
  constructor(raw: number) {
    super(`invalid port ${String(raw)}: expected an integer in [1, 65535]`);
  }
}

export class TrackerPort {
  private declare readonly _brand: 'TrackerPort';

  private constructor(readonly value: number) {}

  static parse(raw: number): TrackerPort {
    if (!Number.isInteger(raw) || raw < 1 || raw > 65535) {
      throw new InvalidPortError(raw);
    }
    return new TrackerPort(raw);
  }

  equals(other: TrackerPort): boolean {
    return this.value === other.value;
  }
}
