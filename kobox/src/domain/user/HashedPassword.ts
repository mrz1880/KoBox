import { DomainError } from '../shared/DomainError.js';

export class InvalidHashedPasswordError extends DomainError {
  constructor() {
    super('invalid hashed password: expected a sha512-crypt ($6$) or yescrypt ($y$) hash');
  }
}

// Only strong crypt(3) formats. Rejecting anything else guarantees a plaintext
// can never end up in the persisted job queue or in usermod -p argv.
export const CRYPT_HASH_PATTERN = /^\$(6|y)\$[A-Za-z0-9./=,$-]+$/;

export class HashedPassword {
  private constructor(readonly value: string) {}

  static parse(raw: string): HashedPassword {
    if (!CRYPT_HASH_PATTERN.test(raw) || raw.length < 16) {
      throw new InvalidHashedPasswordError();
    }
    return new HashedPassword(raw);
  }

  toString(): string {
    return '[password-hash]';
  }

  toJSON(): string {
    return '[password-hash]';
  }
}
