import type { VpnPkiProvisionPort } from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';

export interface VpnUserReport {
  readonly openVpnDirty: boolean;
}

interface Deps {
  readonly pkiProvision: VpnPkiProvisionPort;
}

// Chained after create-user (Phase 3 debt #2): issue the client certificate,
// then let the worker chain render-openvpn so the profiles materialize.
export class ProvisionVpnUser {
  constructor(private readonly deps: Deps) {}

  async execute(input: { readonly username: Username }): Promise<VpnUserReport> {
    await this.deps.pkiProvision.ensureClientMaterial(input.username);
    return { openVpnDirty: true };
  }
}
