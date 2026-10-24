import { DomainError } from '../shared/DomainError.js';

export class InvalidPasswordError extends DomainError {
  constructor(reason: string) {
    super(`invalid password: ${reason}`);
  }
}

const MIN_LENGTH = 8;
// The password travels to the root worker sealed in one RSA-4096 OAEP block
// (446 bytes at most): 100 characters fit even when every one of them takes
// four bytes of UTF-8.
const MAX_LENGTH = 100;

// Opaque secret: reveal() is the only way out, and only adapters handing it to
// a service that keeps its own copy (Samba, Nextcloud) or to the hasher may call
// it. Never logged, never serialized.
export class Password {
  private constructor(private readonly secret: string) {}

  static parse(raw: string): Password {
    if (raw.length < MIN_LENGTH) {
      throw new InvalidPasswordError(`expected at least ${String(MIN_LENGTH)} characters`);
    }
    if (raw.length > MAX_LENGTH) {
      throw new InvalidPasswordError(`expected at most ${String(MAX_LENGTH)} characters`);
    }
    // smbpasswd reads the password and its confirmation as two stdin lines
    if (/[\r\n\0]/.test(raw)) {
      throw new InvalidPasswordError('it contains a line break');
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
