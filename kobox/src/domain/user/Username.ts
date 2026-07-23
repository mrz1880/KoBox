import { DomainError } from '../shared/DomainError.js';

export class InvalidUsernameError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid username ${JSON.stringify(raw)}: ${reason}`);
  }
}

export const USERNAME_PATTERN = /^[a-z][a-z0-9]{0,31}$/;

export class Username {
  // Shell-safety relies on this charset: adapters pass the value as execFile argv,
  // and the pattern leaves no room for metacharacters or option-like prefixes.
  static readonly RESERVED: readonly string[] = [
    'root',
    'plex',
    'ftp',
    'www-data',
    'admin',
    'mysb',
    'kobox',
    'daemon',
    'bin',
    'sys',
    'sync',
    'mail',
    'nobody',
    'sshd',
  ];

  private constructor(readonly value: string) {}

  static parse(raw: string): Username {
    if (!USERNAME_PATTERN.test(raw)) {
      throw new InvalidUsernameError(raw, 'must match [a-z][a-z0-9]{0,31}');
    }
    if (Username.RESERVED.includes(raw)) {
      throw new InvalidUsernameError(raw, 'name is reserved');
    }
    return new Username(raw);
  }

  equals(other: Username): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
