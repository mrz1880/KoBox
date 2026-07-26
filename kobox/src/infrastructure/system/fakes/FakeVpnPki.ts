import type { VpnPkiPort, VpnPkiProvisionPort } from '../../../domain/security/ports.js';
import type { VpnClientMaterial, VpnServerPaths } from '../../../domain/security/vpn.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeVpnPki implements VpnPkiPort, VpnPkiProvisionPort {
  private readonly materials = new Map<string, VpnClientMaterial>();
  readonly ensuredClients: string[] = [];
  pkiEnsured = false;

  setMaterial(username: string, material: VpnClientMaterial): void {
    this.materials.set(username, material);
  }

  ensurePki(): Promise<void> {
    this.pkiEnsured = true;
    return Promise.resolve();
  }

  // Mirrors the adapter contract: issue-once, then keep existing material.
  ensureClientMaterial(username: Username): Promise<void> {
    if (!this.materials.has(username.value)) {
      this.ensuredClients.push(username.value);
      this.materials.set(username.value, {
        caCrt: 'FAKE-CA-PEM',
        userCrt: `FAKE-${username.value}-PEM`,
        userKey: `FAKE-${username.value}-KEY`,
      });
    }
    return Promise.resolve();
  }

  removeClientMaterial(username: Username): Promise<void> {
    this.materials.delete(username.value);
    return Promise.resolve();
  }

  serverPaths(): VpnServerPaths {
    return {
      caCrt: '/etc/openvpn/kobox-pki/ca.crt',
      serverCrt: '/etc/openvpn/kobox-pki/issued/server.crt',
      serverKey: '/etc/openvpn/kobox-pki/private/server.key',
      crlPem: '/etc/openvpn/kobox-pki/crl.pem',
    };
  }

  clientMaterial(username: Username): Promise<VpnClientMaterial | undefined> {
    return Promise.resolve(this.materials.get(username.value));
  }
}
