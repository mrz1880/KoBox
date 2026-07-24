import { DomainError } from '../shared/DomainError.js';

export class InvalidBlocklistUrlError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid blocklist url ${JSON.stringify(raw)}: ${reason}`);
  }
}

// §5.6 fix: an unverified transport is unrepresentable — https only.
export class BlocklistUrl {
  private constructor(readonly value: string) {}

  static parse(raw: string): BlocklistUrl {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new InvalidBlocklistUrlError(raw, 'not a URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new InvalidBlocklistUrlError(raw, 'scheme must be https');
    }
    if (!/^[a-z0-9.-]+$/i.test(parsed.hostname)) {
      throw new InvalidBlocklistUrlError(raw, 'host contains unsafe characters');
    }
    return new BlocklistUrl(raw);
  }

  // Subscription credentials are appended at fetch time only; the stored
  // value never carries them (they must not reach the DB or logs).
  withCredentials(username: string, pin: string): string {
    const url = new URL(this.value);
    url.searchParams.set('username', username);
    url.searchParams.set('pin', pin);
    return url.toString();
  }
}
