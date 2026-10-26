import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TotpPort } from '../../domain/portal/ports.js';
import { TotpSecret } from '../../domain/portal/TotpSecret.js';

const STEP_MS = 30_000;
const DIGITS = 6;
// one step either side: a phone clock a little off still signs in
const DRIFT_STEPS = 1;
const SECRET_BYTES = 20;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32.charAt(parseInt(bits.slice(i, i + 5), 2));
  }
  return out;
}

function fromBase32(text: string): Buffer {
  let bits = '';
  for (const char of text) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// The code an authenticator app shows for this secret at this time; what the
// end-to-end test types, as a member would.
export function totpCodeAt(secret: TotpSecret, nowMs: number): string {
  return codeAt(fromBase32(secret.value), Math.floor(nowMs / STEP_MS));
}

// RFC 4226 dynamic truncation of HMAC-SHA1 over the big-endian step counter
function codeAt(key: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const value = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** DIGITS).padStart(DIGITS, '0');
}

export class CryptoTotp implements TotpPort {
  newSecret(): TotpSecret {
    return TotpSecret.parse(toBase32(randomBytes(SECRET_BYTES)));
  }

  stepOf(secret: TotpSecret, code: string, nowMs: number): number | undefined {
    const key = fromBase32(secret.value);
    const current = Math.floor(nowMs / STEP_MS);
    for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
      // constant time: how long a wrong code takes says nothing about it
      const expected = Buffer.from(codeAt(key, step));
      const given = Buffer.from(code);
      if (given.length === expected.length && timingSafeEqual(given, expected)) {
        return step;
      }
    }
    return undefined;
  }
}
