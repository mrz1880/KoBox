import { DomainError } from '../shared/DomainError.js';

export class InvalidFilehosterLinkError extends DomainError {
  constructor(raw: string, reason: string) {
    super(`invalid filehoster link ${JSON.stringify(raw)}: ${reason}`);
  }
}

// The link a user submits (1fichier, …). It is handed to the debrid API as a
// query parameter, never to a shell — so URL validity + an http(s) scheme is
// the whole contract. KoBox never scrapes a source; it debrids a given link.
export class FilehosterLink {
  private constructor(readonly value: string) {}

  static parse(raw: string): FilehosterLink {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new InvalidFilehosterLinkError(raw, 'not a URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new InvalidFilehosterLinkError(raw, 'scheme must be http or https');
    }
    return new FilehosterLink(raw);
  }

  toString(): string {
    return this.value;
  }
}
