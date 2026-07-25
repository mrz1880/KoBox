import type { VpnPkiProvisionPort } from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { VpnUserReport } from './ProvisionVpnUser.js';

interface Deps {
  readonly pkiProvision: VpnPkiProvisionPort;
}

// Chained after delete-user: the material disappears, the next render drops
// the profiles. Revocation lists are Phase 5 — removal already cuts issuance.
export class DeprovisionVpnUser {
  constructor(private readonly deps: Deps) {}

  async execute(input: { readonly username: Username }): Promise<VpnUserReport> {
    await this.deps.pkiProvision.removeClientMaterial(input.username);
    return { openVpnDirty: true };
  }
}
