import { DomainError } from '../shared/DomainError.js';

export class InvalidLocalPathError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid local path ${JSON.stringify(raw)}: ${reason}`);
  }
}

// What a finished download left on this box. Unlike RemotePath, this one has to
// tolerate whatever a torrent called itself — spaces, brackets, apostrophes are
// all normal in release names — so the charset stays wide.
//
// It is safe anyway, for a reason that is worth stating: it only ever reaches
// execFile as one argv element, never a shell string. What it must NOT do is
// escape the member's own home, so `..` and NUL are refused outright and the
// caller is expected to check the prefix.
export class LocalPath {
  private constructor(readonly value: string) {}

  static parse(raw: string): LocalPath {
    if (!raw.startsWith('/')) {
      throw new InvalidLocalPathError(raw, 'it is not absolute');
    }
    if (raw.includes('\0')) {
      throw new InvalidLocalPathError(raw, 'it contains a NUL');
    }
    if (raw.split('/').includes('..')) {
      throw new InvalidLocalPathError(raw, 'it climbs out of itself');
    }
    if (raw.length > 4096) {
      throw new InvalidLocalPathError(raw, 'longer than a path can be');
    }
    return new LocalPath(raw.replace(/\/+$/, '') || '/');
  }

  // The last segment: what a member recognises, and what lands on the other
  // machine under that name.
  get name(): string {
    return this.value.slice(this.value.lastIndexOf('/') + 1);
  }

  isInside(directory: string): boolean {
    const root = directory.replace(/\/+$/, '');
    return this.value === root || this.value.startsWith(`${root}/`);
  }

  equals(other: LocalPath): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
