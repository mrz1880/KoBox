import type { SessionTokenPort } from '../../../domain/portal/ports.js';

// Deterministic tokens for tests; "hashing" is a visible, reversible prefix
// so assertions can relate raw tokens to stored ids.
export class FakeSessionTokens implements SessionTokenPort {
  private counter = 0;

  // 64 hex characters, the shape the real generator emits: a member's app token
  // is parsed by a value object that refuses anything else, so a fake producing
  // "token-0001" would not be substitutable for the thing it stands in for.
  // Still deterministic — the counter is simply rendered into the last digits.
  generate(): string {
    this.counter += 1;
    return `${'0'.repeat(60)}${String(this.counter).padStart(4, '0')}`;
  }

  hashToken(token: string): string {
    return `hashed:${token}`;
  }
}
