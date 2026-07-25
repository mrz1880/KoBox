import type { VpnVariant } from '../../domain/security/vpn.js';
import type { Username } from '../../domain/user/Username.js';

// Reads a user's rendered .ovpn profile for the portal download. The portal
// runs as the kobox-portal group, which owns the rendered profiles (0640);
// the path is always derived from the authenticated session, never from input.
export interface VpnProfileStorePort {
  read(username: Username, variant: VpnVariant): Promise<string | undefined>;
}
