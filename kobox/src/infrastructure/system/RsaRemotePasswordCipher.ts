import { RemotePassword } from '../../domain/sync/RemotePassword.js';
import type {
  RemotePasswordOpenerPort,
  RemotePasswordSealerPort,
} from '../../domain/sync/ports.js';
import {
  DEFAULT_DEBRID_PRIVATE_KEY,
  DEFAULT_DEBRID_PUBLIC_KEY,
} from './RsaDebridKeyCipher.js';
import { openString, readPem, sealString } from './rsaSealing.js';

// The same host key pair that seals per-member debrid keys. One pair, generated
// once at install, never regenerated — a second pair would mean a second thing
// to back up and a second way to lose everything sealed with it.
//
// Each PEM is read LAZILY, per call: the non-root portal only ever seals, so it
// never opens (nor needs read access to) the private half.
export class RsaRemotePasswordCipher implements RemotePasswordSealerPort, RemotePasswordOpenerPort {
  constructor(
    private readonly publicKeyPath: string = DEFAULT_DEBRID_PUBLIC_KEY,
    private readonly privateKeyPath: string = DEFAULT_DEBRID_PRIVATE_KEY,
  ) {}

  async seal(password: RemotePassword): Promise<string> {
    const pem = await readPem(this.publicKeyPath, 'public key');
    return sealString(pem, password.reveal());
  }

  async open(sealed: string): Promise<RemotePassword> {
    const pem = await readPem(this.privateKeyPath, 'private key');
    return RemotePassword.parse(openString(pem, sealed, 'password'));
  }
}
