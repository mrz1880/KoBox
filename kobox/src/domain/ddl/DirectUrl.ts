import { DomainError } from '../shared/DomainError.js';

export class InvalidDirectUrlError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid direct url ${JSON.stringify(raw)}: ${reason}`);
  }
}

// The unrestricted URL returned by the debrid service — always https (a debrid
// CDN link). Handed to aria2 as a download target.
export class DirectUrl {
  private constructor(readonly value: string) {}

  static parse(raw: string): DirectUrl {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new InvalidDirectUrlError(raw, 'not a URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new InvalidDirectUrlError(raw, 'scheme must be https');
    }
    return new DirectUrl(raw);
  }

  toString(): string {
    return this.value;
  }
}
