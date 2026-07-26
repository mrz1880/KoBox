import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VpnPkiPort } from '../../domain/security/ports.js';
import type { VpnClientMaterial, VpnServerPaths } from '../../domain/security/vpn.js';
import type { Username } from '../../domain/user/Username.js';

export const DEFAULT_PKI_DIR = '/etc/openvpn/kobox-pki';

// Reads an easy-rsa-shaped PKI tree. Generation is Phase 4's job; here a
// missing file simply means "no profile for this user yet".
export class FsVpnPkiAdapter implements VpnPkiPort {
  constructor(private readonly baseDir: string = DEFAULT_PKI_DIR) {}

  serverPaths(): VpnServerPaths {
    return {
      caCrt: join(this.baseDir, 'ca.crt'),
      serverCrt: join(this.baseDir, 'issued/server.crt'),
      serverKey: join(this.baseDir, 'private/server.key'),
      crlPem: join(this.baseDir, 'crl.pem'),
    };
  }

  async clientMaterial(username: Username): Promise<VpnClientMaterial | undefined> {
    try {
      const [caCrt, userCrt, userKey] = await Promise.all([
        readFile(join(this.baseDir, 'ca.crt'), 'utf8'),
        readFile(join(this.baseDir, `issued/${username.value}.crt`), 'utf8'),
        readFile(join(this.baseDir, `private/${username.value}.key`), 'utf8'),
      ]);
      return { caCrt: caCrt.trim(), userCrt: userCrt.trim(), userKey: userKey.trim() };
    } catch {
      return undefined;
    }
  }
}
