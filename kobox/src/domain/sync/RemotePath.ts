import { DomainError } from '../shared/DomainError.js';

export class InvalidRemotePathError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid remote path ${JSON.stringify(raw)}: ${reason}`);
  }
}

// The root directory on the member's own machine. It reaches a remote `mkdir -p`
// and the destination half of an rsync, so the charset stays deliberately narrow
// — a space or a quote there would need shell quoting we have no intention of
// getting right, and `..` would let a typo climb out of the folder they chose.
const PATH_PATTERN = /^\/[A-Za-z0-9._\-/]*$/;

export class RemotePath {
  private constructor(readonly value: string) {}

  static parse(raw: string): RemotePath {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/')) {
      throw new InvalidRemotePathError(raw, 'it must start at the root of the other machine');
    }
    if (!PATH_PATTERN.test(trimmed)) {
      throw new InvalidRemotePathError(raw, 'letters, digits, dot, underscore, dash and slash only');
    }
    if (trimmed.split('/').includes('..')) {
      throw new InvalidRemotePathError(raw, 'it climbs out of itself');
    }
    // one trailing slash or none must describe the same directory, so joining a
    // category can never produce a doubled separator
    const withoutTrailing = trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed;
    return new RemotePath(withoutTrailing);
  }

  join(segment: string): string {
    return `${this.value}/${segment}`;
  }

  equals(other: RemotePath): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
