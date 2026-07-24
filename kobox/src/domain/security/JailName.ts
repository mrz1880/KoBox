import { DomainError } from '../shared/DomainError.js';

export class InvalidJailNameError extends DomainError {
  constructor(raw: string) {
    super(`invalid jail name ${JSON.stringify(raw)}`);
  }
}

const JAIL_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export class JailName {
  private constructor(readonly value: string) {}

  static parse(raw: string): JailName {
    if (!JAIL_NAME_PATTERN.test(raw)) {
      throw new InvalidJailNameError(raw);
    }
    return new JailName(raw);
  }

  equals(other: JailName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
