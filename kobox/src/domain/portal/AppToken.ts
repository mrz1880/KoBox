import { DomainError } from '../shared/DomainError.js';

export class InvalidAppTokenError extends DomainError {
  constructor(reason: string) {
    super(`invalid app token: ${reason}`);
  }
}

// 32 bytes of CSPRNG rendered as hex — the shape SessionTokenPort.generate()
// already produces. Reusing it keeps one generator rather than two.
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

// What a machine presents instead of a member's password: Radarr, Sonarr, a
// script, a phone app. Issued by KoBox, never chosen, and revocable on its own
// so a leaked download-client config costs the member their token and not their
// account.
//
// Opaque like Password and DebridApiKey: reveal() is the only way out, and
// toString/toJSON stay redacted so it cannot leak through a log line or a
// rendered page.
export class AppToken {
  private constructor(private readonly secret: string) {}

  static parse(raw: string): AppToken {
    if (!TOKEN_PATTERN.test(raw)) {
      throw new InvalidAppTokenError('expected 64 hexadecimal characters');
    }
    return new AppToken(raw);
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
