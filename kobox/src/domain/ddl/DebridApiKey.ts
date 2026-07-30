import { DomainError } from '../shared/DomainError.js';

export class InvalidDebridApiKeyError extends DomainError {
  constructor(reason: string) {
    super(`invalid debrid api key: ${reason}`);
  }
}

// AllDebrid keys are opaque alphanumerics; we only bound the shape so a typo or
// a pasted URL is rejected at the boundary instead of failing at the API.
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

// Opaque secret, mirroring Password: reveal() is the only way out, and only the
// adapter that calls AllDebrid may use it. toString/toJSON stay redacted so the
// key cannot leak through a log line, a template or a serialized error.
export class DebridApiKey {
  private constructor(private readonly secret: string) {}

  static parse(raw: string): DebridApiKey {
    const trimmed = raw.trim();
    if (!KEY_PATTERN.test(trimmed)) {
      throw new InvalidDebridApiKeyError('expected 16-128 alphanumeric characters');
    }
    return new DebridApiKey(trimmed);
  }

  reveal(): string {
    return this.secret;
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }
}
