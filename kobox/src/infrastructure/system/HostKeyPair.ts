import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { HostKeyPairPort } from '../../domain/security/ports.js';

// Where every installed box keeps its pair. The file names still say "debrid"
// because the pair was first made for debrid keys: they stay as they are, since
// a box in production holds its private half at exactly this path and moving
// the default would make the installer mint a new pair, orphaning everything
// sealed with the old one.
export const DEFAULT_HOST_PUBLIC_KEY = '/etc/kobox/debrid-pub.pem';
export const DEFAULT_HOST_PRIVATE_KEY = '/etc/kobox/debrid-key.pem';

const MODULUS_BITS = 4096;

// The pair that seals NAS passwords and passwords in transit through the job
// queue. Two rules keep what it sealed alive across re-installs and upgrades:
//   - an existing PRIVATE half is never regenerated (that would orphan every
//     sealed value, silently);
//   - a missing PUBLIC half is re-DERIVED from the private one, never an excuse
//     to mint a new pair.
// Only when there is no private key at all is a fresh pair generated.
export class FsHostKeyPair implements HostKeyPairPort {
  constructor(
    private readonly publicKeyPath: string = DEFAULT_HOST_PUBLIC_KEY,
    private readonly privateKeyPath: string = DEFAULT_HOST_PRIVATE_KEY,
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
    // 0600 root:root: the worker is the only process that may open this
    await writeFile(this.privateKeyPath, privateKey, { mode: 0o600 });
    await this.writePublic(publicKey);
  }

  // 0644: the non-root portal must read it to seal a value
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
