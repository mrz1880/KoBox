import { DomainError } from '../shared/DomainError.js';

export class InvalidBatchSizeError extends DomainError {
  constructor(raw: number) {
    super(`invalid batch size ${String(raw)}: expected 0 or a positive whole number`);
  }
}

// How many waiting transfers one pass takes on. Zero means "everything waiting"
// — the legacy stored that same 0 and its screen read "0 (Tout)". A member with
// a slow link caps it so one huge evening does not monopolise the connection.
export class TransferBatchSize {
  private constructor(readonly value: number) {}

  static parse(raw: number): TransferBatchSize {
    if (!Number.isInteger(raw) || raw < 0 || raw > 1000) {
      throw new InvalidBatchSizeError(raw);
    }
    return new TransferBatchSize(raw);
  }

  static unlimited(): TransferBatchSize {
    return new TransferBatchSize(0);
  }

  get isUnlimited(): boolean {
    return this.value === 0;
  }

  equals(other: TransferBatchSize): boolean {
    return this.value === other.value;
  }
}
