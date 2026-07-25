import { readFile } from 'node:fs/promises';
import type { VpnProfileStorePort } from '../../application/portal/ports.js';
import { VPN_PROFILES_BASE, type VpnVariant } from '../../domain/security/vpn.js';
import type { Username } from '../../domain/user/Username.js';

// The path mirrors renderOpenVpnClientProfile: both the writer (root worker)
// and this reader (portal) agree on it structurally, never by passing paths.
export class FsVpnProfileStore implements VpnProfileStorePort {
  constructor(private readonly base: string = VPN_PROFILES_BASE) {}

  async read(username: Username, variant: VpnVariant): Promise<string | undefined> {
    const path = `${this.base}/${username.value}/kobox-${variant}.ovpn`;
    try {
      return await readFile(path, 'utf8');
    } catch {
      return undefined;
    }
  }
}
