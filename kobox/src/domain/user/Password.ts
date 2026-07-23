import { DomainError } from '../shared/DomainError.js';

export class InvalidPasswordError extends DomainError {
  constructor() {
    super('invalid password: expected at least 8 characters');
  }
}

// Opaque secret: reveal() is the only way out, and only adapters feeding the
// system (chpasswd stdin) may call it. Never logged, never serialized.
export class Password {
  private constructor(private readonly secret: string) {}

  static parse(raw: string): Password {
    if (raw.length < 8) {
      throw new InvalidPasswordError();
    }
    return new Password(raw);
  }

  reveal(): string {
    return this.secret;
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }
}
