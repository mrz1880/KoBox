import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { DebridKeyPairPort } from '../../domain/ddl/ports.js';
import {
  DEFAULT_DEBRID_PRIVATE_KEY,
  DEFAULT_DEBRID_PUBLIC_KEY,
} from './RsaDebridKeyCipher.js';

const MODULUS_BITS = 4096;

// The pair that seals per-user debrid keys. Two rules keep stored keys alive
// across re-installs and upgrades:
//   - an existing PRIVATE half is never regenerated (that would orphan every
//     stored key, silently);
//   - a missing PUBLIC half is re-DERIVED from the private one, never an excuse
//     to mint a new pair.
// Only when there is no private key at all is a fresh pair generated.
export class FsDebridKeyPair implements DebridKeyPairPort {
  constructor(
    private readonly publicKeyPath: string = DEFAULT_DEBRID_PUBLIC_KEY,
    private readonly privateKeyPath: string = DEFAULT_DEBRID_PRIVATE_KEY,
  ) {}

  async ensurePair(): Promise<void> {
    const existingPrivate = await this.read(this.privateKeyPath);
    if (existingPrivate !== undefined) {
      await this.writePublic(
        createPublicKey(existingPrivate).export({ type: 'spki', format: 'pem' }).toString(),
      );
      return;
    }
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: MODULUS_BITS,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    // 0600 root:root — the worker is the only process that may open this
    await writeFile(this.privateKeyPath, privateKey, { mode: 0o600 });
    await this.writePublic(publicKey);
  }

  // 0644: the non-root portal must read it to seal a key
  private async writePublic(pem: string): Promise<void> {
    if ((await this.read(this.publicKeyPath)) !== pem) {
      await writeFile(this.publicKeyPath, pem, { mode: 0o644 });
    }
  }

  private async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return undefined;
    }
  }
}
