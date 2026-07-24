import { DomainError } from '../shared/DomainError.js';

export class InvalidInfoHashError extends DomainError {
  constructor(raw: string) {
    super(`invalid info hash ${JSON.stringify(raw)}: expected 40 hexadecimal characters`);
  }
}

export const INFO_HASH_PATTERN = /^[0-9a-fA-F]{40}$/;

// Normalized to uppercase: rtorrent reports uppercase hashes and equality
// must not depend on the caller's casing.
export class InfoHash {
  private constructor(readonly value: string) {}

  static parse(raw: string): InfoHash {
    if (!INFO_HASH_PATTERN.test(raw)) {
      throw new InvalidInfoHashError(raw);
    }
    return new InfoHash(raw.toUpperCase());
  }

  equals(other: InfoHash): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
