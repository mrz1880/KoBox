import { createHash, randomBytes } from 'node:crypto';
import type { SessionTokenPort } from '../../domain/portal/ports.js';

export class CryptoSessionTokens implements SessionTokenPort {
  generate(): string {
    return randomBytes(32).toString('hex');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
