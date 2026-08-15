import { DomainError } from '../shared/DomainError.js';

export class InvalidRemoteHostError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid remote host ${JSON.stringify(raw)}: ${reason}`);
  }
}

// Hostname labels or a bare address. The charset is what makes this value safe
// to hand to execFile as the host half of user@host: no space, no semicolon, no
// slash, and — the one that matters — no leading dash, which ssh would read as
// an option (`-oProxyCommand=...` is a remote code execution dressed as a host).
const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

export class RemoteHost {
  private constructor(readonly value: string) {}

  static parse(raw: string): RemoteHost {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidRemoteHostError(raw, 'it is empty');
    }
    if (trimmed.length > 253) {
      throw new InvalidRemoteHostError(raw, 'longer than a hostname can be');
    }
    if (!HOST_PATTERN.test(trimmed)) {
      throw new InvalidRemoteHostError(raw, 'letters, digits, dots and dashes only');
    }
    return new RemoteHost(trimmed);
  }

  equals(other: RemoteHost): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
