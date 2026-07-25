import { DomainError } from '../shared/DomainError.js';

// Debian package versions are loose (epochs, tildes, +git suffixes) — the VO
// pins a shell-safe charset and sane length, not semver. Ordering is Phase 5
// (upgrades); v1 only records what was installed.
const VERSION_PATTERN = /^[0-9][0-9A-Za-z.+~:-]{0,63}$/;

export class InvalidVersionError extends DomainError {
  constructor(raw: string) {
    super(`invalid version ${JSON.stringify(raw)}`);
  }
}

export class Version {
  private constructor(readonly value: string) {}

  static parse(raw: string): Version {
    if (!VERSION_PATTERN.test(raw)) {
      throw new InvalidVersionError(raw);
    }
    return new Version(raw);
  }

  equals(other: Version): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
