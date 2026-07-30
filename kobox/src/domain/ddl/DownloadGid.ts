import { DomainError } from '../shared/DomainError.js';

export const GID_PATTERN = /^[0-9a-f]{16}$/;

export class InvalidDownloadGidError extends DomainError {
  constructor(raw: string) {
    super(`invalid aria2 gid ${JSON.stringify(raw)}: expected 16 hex characters`);
  }
}

// aria2's download handle (returned by addUri, used by tellStatus). 16 hex
// chars — validated so a garbage handle can never round-trip through the DB.
export class DownloadGid {
  private constructor(readonly value: string) {}

  static parse(raw: string): DownloadGid {
    if (!GID_PATTERN.test(raw)) {
      throw new InvalidDownloadGidError(raw);
    }
    return new DownloadGid(raw);
  }

  equals(other: DownloadGid): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
