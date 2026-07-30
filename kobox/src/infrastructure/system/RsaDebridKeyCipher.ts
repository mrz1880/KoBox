import { constants, privateDecrypt, publicEncrypt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DebridApiKey } from '../../domain/ddl/DebridApiKey.js';
import type {
  DebridKeyDecryptorPort,
  DebridKeyEncryptorPort,
} from '../../domain/ddl/ports.js';

export const DEFAULT_DEBRID_PUBLIC_KEY = '/etc/kobox/debrid-pub.pem';
export const DEFAULT_DEBRID_PRIVATE_KEY = '/etc/kobox/debrid-key.pem';

export class DebridKeyCipherError extends Error {
  constructor(detail: string) {
    super(`debrid key cipher: ${detail}`);
    this.name = 'DebridKeyCipherError';
  }
}

// RSA-OAEP/SHA-256 over node:crypto — no openssl subprocess, and an AllDebrid
// key is short enough to fit one block, so no hybrid AES envelope is needed.
//
// Each PEM is read LAZILY, per call: the non-root portal only ever calls
// encrypt(), so it never opens (nor needs read access to) the private half.
export class RsaDebridKeyCipher implements DebridKeyEncryptorPort, DebridKeyDecryptorPort {
  constructor(
    private readonly publicKeyPath: string = DEFAULT_DEBRID_PUBLIC_KEY,
    private readonly privateKeyPath: string = DEFAULT_DEBRID_PRIVATE_KEY,
  ) {}

  async encrypt(key: DebridApiKey): Promise<string> {
    const pem = await this.read(this.publicKeyPath, 'public key');
    const sealed = publicEncrypt(
      { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(key.reveal(), 'utf8'),
    );
    return sealed.toString('base64');
  }

  async decrypt(sealed: string): Promise<DebridApiKey> {
    const pem = await this.read(this.privateKeyPath, 'private key');
    let opened: Buffer;
    try {
      opened = privateDecrypt(
        { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(sealed, 'base64'),
      );
    } catch {
      // a key sealed with a DIFFERENT pair (restored DB without its PEM) must
      // read as an actionable failure, not a crash — and never echo the blob
      throw new DebridKeyCipherError('stored key could not be decrypted with this host key');
    }
    return DebridApiKey.parse(opened.toString('utf8'));
  }

  private async read(path: string, what: string): Promise<string> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      throw new DebridKeyCipherError(`${what} unreadable at ${path}`);
    }
  }
}
