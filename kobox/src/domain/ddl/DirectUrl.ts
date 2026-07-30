import { DomainError } from '../shared/DomainError.js';

export class InvalidDirectUrlError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid direct url ${JSON.stringify(raw)}: ${reason}`);
  }
}

// The unrestricted URL returned by the debrid service, handed to aria2 as a
// download target. AllDebrid CDN links are usually https but not always — their
// own docs show http direct links — so http(s) is the contract (an http(s)
// scheme is what makes it a fetchable target; the value is never shell-eval'd).
export class DirectUrl {
  private constructor(readonly value: string) {}

  static parse(raw: string): DirectUrl {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new InvalidDirectUrlError(raw, 'not a URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new InvalidDirectUrlError(raw, 'scheme must be http or https');
    }
    return new DirectUrl(raw);
  }

  toString(): string {
    return this.value;
  }
}
