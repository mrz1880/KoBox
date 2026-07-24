import type { VpnSettings } from '../../domain/security/FirewallPolicy.js';

// Installation-wide network layout, resolved once in composition (env-backed
// there; tests inject fixtures). Everything downstream consumes this shape.
export interface SecuritySettings {
  readonly sshPort: number;
  readonly portalPort: number;
  readonly vpn: VpnSettings;
}
