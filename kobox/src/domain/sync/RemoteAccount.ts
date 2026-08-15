import { DomainError } from '../shared/DomainError.js';

export class InvalidRemoteAccountError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid remote account ${JSON.stringify(raw)}: ${reason}`);
  }
}

// The account name on somebody else's machine, so its rules are not ours: a
// Synology account may be capitalised, and we have no say in that. What we do
// insist on is that it cannot become an ssh option or split user@host.
const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class RemoteAccount {
  private constructor(readonly value: string) {}

  static parse(raw: string): RemoteAccount {
    const trimmed = raw.trim();
    if (!ACCOUNT_PATTERN.test(trimmed)) {
      throw new InvalidRemoteAccountError(
        raw,
        'letters, digits, dot, underscore or dash, up to 64, not starting with a dash',
      );
    }
    return new RemoteAccount(trimmed);
  }

  equals(other: RemoteAccount): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
