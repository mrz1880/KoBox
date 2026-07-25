import type { SessionTokenPort } from '../../../domain/portal/ports.js';

// Deterministic tokens for tests; "hashing" is a visible, reversible prefix
// so assertions can relate raw tokens to stored ids.
export class FakeSessionTokens implements SessionTokenPort {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `token-${String(this.counter).padStart(4, '0')}`;
  }

  hashToken(token: string): string {
    return `hashed:${token}`;
  }
}
