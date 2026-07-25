import type { VpnPkiPort } from '../../../domain/security/ports.js';
import type { VpnClientMaterial, VpnServerPaths } from '../../../domain/security/vpn.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeVpnPki implements VpnPkiPort {
  private readonly materials = new Map<string, VpnClientMaterial>();

  setMaterial(username: string, material: VpnClientMaterial): void {
    this.materials.set(username, material);
  }

  serverPaths(): VpnServerPaths {
    return {
      caCrt: '/etc/openvpn/kobox-pki/ca.crt',
      serverCrt: '/etc/openvpn/kobox-pki/issued/server.crt',
      serverKey: '/etc/openvpn/kobox-pki/private/server.key',
    };
  }

  clientMaterial(username: Username): Promise<VpnClientMaterial | undefined> {
    return Promise.resolve(this.materials.get(username.value));
  }
}
