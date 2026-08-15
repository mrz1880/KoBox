import { constants, privateDecrypt, publicEncrypt } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export class RsaSealingError extends Error {
  constructor(detail: string) {
    super(`rsa sealing: ${detail}`);
    this.name = 'RsaSealingError';
  }
}

// RSA-OAEP/SHA-256 over node:crypto — no openssl subprocess. The values KoBox
// seals (an API key, a NAS password) all fit in one block, so no hybrid AES
// envelope is needed.
//
// Shared by every cipher that uses the host key pair, so the padding, the hash
// and the failure wording are decided in exactly one place.

export async function readPem(path: string, what: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new RsaSealingError(`${what} unreadable at ${path}`);
  }
}

export function sealString(pem: string, value: string): string {
  return publicEncrypt(
    { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(value, 'utf8'),
  ).toString('base64');
}

export function openString(pem: string, sealed: string, what: string): string {
  try {
    return privateDecrypt(
      { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(sealed, 'base64'),
    ).toString('utf8');
  } catch {
    // a value sealed with a DIFFERENT pair (a restored database without its
    // PEM) must read as an actionable failure, and never echo the blob back
    throw new RsaSealingError(`stored ${what} could not be opened with this host key`);
  }
}
