import { DomainError } from '../shared/DomainError.js';

export class InvalidQuotaError extends DomainError {
  constructor(rawBytes: number) {
    super(`invalid quota ${String(rawBytes)} bytes: expected a non-negative integer`);
  }
}

const BYTES_PER_GIB = 1024 ** 3;

export class Quota {
  private constructor(private readonly valueBytes: number) {}

  static bytes(raw: number): Quota {
    if (!Number.isInteger(raw) || raw < 0) {
      throw new InvalidQuotaError(raw);
    }
    return new Quota(raw);
  }

  static gib(raw: number): Quota {
    return Quota.bytes(raw * BYTES_PER_GIB);
  }

  // Legacy bug #72: the ceiling must count the space the user already occupies,
  // otherwise a quota can never be raised above the remaining free space.
  static maxSettable(usedByUser: Quota, freeOnDisk: Quota): Quota {
    return Quota.bytes(usedByUser.valueBytes + freeOnDisk.valueBytes);
  }

  toBytes(): number {
    return this.valueBytes;
  }

  toGib(): number {
    return this.valueBytes / BYTES_PER_GIB;
  }

  fitsWithin(ceiling: Quota): boolean {
    return this.valueBytes <= ceiling.valueBytes;
  }

  equals(other: Quota): boolean {
    return this.valueBytes === other.valueBytes;
  }

  toString(): string {
    return `${this.valueBytes} B`;
  }
}
