import { DomainError } from '../shared/DomainError.js';

export class InvalidTotpSecretError extends DomainError {
  constructor() {
    super('invalid two-step secret');
  }
}

// The shared secret behind a member's 6-digit codes, as authenticator apps
// take it: 20 random bytes in base32 (RFC 4648), 32 characters, no padding.
const BASE32_160_BITS = /^[A-Z2-7]{32}$/;

export class TotpSecret {
  private constructor(readonly value: string) {}

  static parse(raw: string): TotpSecret {
    if (!BASE32_160_BITS.test(raw)) {
      throw new InvalidTotpSecretError();
    }
    return new TotpSecret(raw);
  }
}
