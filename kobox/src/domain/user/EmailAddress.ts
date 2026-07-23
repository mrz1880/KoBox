import { DomainError } from '../shared/DomainError.js';

export class InvalidEmailAddressError extends DomainError {
  constructor(raw: string) {
    super(`invalid email address ${JSON.stringify(raw)}`);
  }
}

// Pragmatic RFC-lite: local@domain with at least one dot in the domain.
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export class EmailAddress {
  private constructor(readonly value: string) {}

  static parse(raw: string): EmailAddress {
    const normalized = raw.toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new InvalidEmailAddressError(raw);
    }
    return new EmailAddress(normalized);
  }

  equals(other: EmailAddress): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
