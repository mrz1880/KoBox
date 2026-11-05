import { DomainError } from '../shared/DomainError.js';

export class InvalidHostKeyFingerprintError extends DomainError {
  constructor(raw: string) {
    super(`invalid host key fingerprint "${raw}": expected SHA256:<base64>`);
  }
}

// The identity a member's machine presents, as ssh prints its host key:
// "SHA256:" and the base64 digest
const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]+=*$/;

export class HostKeyFingerprint {
  private declare readonly _brand: 'HostKeyFingerprint';

  private constructor(readonly value: string) {}

  static parse(raw: string): HostKeyFingerprint {
    if (!FINGERPRINT_PATTERN.test(raw)) {
      throw new InvalidHostKeyFingerprintError(raw);
    }
    return new HostKeyFingerprint(raw);
  }

  equals(other: HostKeyFingerprint): boolean {
    return this.value === other.value;
  }
}
