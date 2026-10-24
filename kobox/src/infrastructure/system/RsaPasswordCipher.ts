import { Password } from '../../domain/user/Password.js';
import type { PasswordOpenerPort, PasswordSealerPort } from '../../domain/user/ports.js';
import {
  DEFAULT_DEBRID_PRIVATE_KEY,
  DEFAULT_DEBRID_PUBLIC_KEY,
} from './RsaDebridKeyCipher.js';
import { openString, readPem, sealString } from './rsaSealing.js';

// The host key pair that already seals debrid keys and NAS passwords: one pair,
// generated once at install, never regenerated.
//
// Each PEM is read lazily, per call: the non-root portal only ever seals, so it
// never opens (nor needs read access to) the private half.
export class RsaPasswordCipher implements PasswordSealerPort, PasswordOpenerPort {
  constructor(
    private readonly publicKeyPath: string = DEFAULT_DEBRID_PUBLIC_KEY,
    private readonly privateKeyPath: string = DEFAULT_DEBRID_PRIVATE_KEY,
  ) {}

  async seal(password: Password): Promise<string> {
    const pem = await readPem(this.publicKeyPath, 'public key');
    return sealString(pem, password.reveal());
  }

  async open(sealed: string): Promise<Password> {
    const pem = await readPem(this.privateKeyPath, 'private key');
    return Password.parse(openString(pem, sealed, 'password'));
  }
}
