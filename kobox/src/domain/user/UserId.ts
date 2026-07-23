import { DomainError } from '../shared/DomainError.js';

export class InvalidUserIdError extends DomainError {
  constructor(raw: number) {
    super(`invalid user id ${String(raw)}: expected a positive integer`);
  }
}

export class UserId {
  private constructor(readonly value: number) {}

  static parse(raw: number): UserId {
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new InvalidUserIdError(raw);
    }
    return new UserId(raw);
  }

  equals(other: UserId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
