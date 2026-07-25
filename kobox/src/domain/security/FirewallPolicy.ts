import { DomainError } from '../shared/DomainError.js';
import type { IpAddress } from '../shared/IpAddress.js';
import type { Username } from '../user/Username.js';
import type { Cidr } from './Cidr.js';

export class InvalidFirewallPolicyError extends DomainError {
  constructor(reason: string) {
    super(`invalid firewall policy: ${reason}`);
  }
}

export interface FirewallUser {
  readonly username: Username;
  readonly uid: number;
  readonly rtorrentPort: number;
  readonly addresses: readonly IpAddress[];
}

export interface VpnSettings {
  readonly tunGwPort: number;
  readonly tunPort: number;
  readonly tapPort: number;
  readonly tunGwSubnet: Cidr;
  readonly tunSubnet: Cidr;
  readonly tapSubnet: Cidr;
}

export interface FirewallPolicyProps {
  readonly sshPort: number;
  readonly portalPort: number;
  readonly vpn: VpnSettings;
  readonly users: readonly FirewallUser[];
  // true when the kernel ipset kobox-bl exists: the render then includes the
  // blocklist drop (pgl successor); false keeps the ruleset loadable on
  // hosts without the ip_set module
  readonly blocklistSet: boolean;
}

function assertPort(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new InvalidFirewallPolicyError(`${what} must be a port in 1-65535, got ${String(value)}`);
  }
}

// The whole desired firewall state. Loopback, established and SSH survival are
// invariants of the type, not options: no input can produce a ruleset without
// them (the §5.2 destructive-refresh cycle AND the lockout risk both die here).
export class FirewallPolicy {
  private constructor(
    readonly sshPort: number,
    readonly portalPort: number,
    readonly vpn: VpnSettings,
    readonly users: readonly FirewallUser[],
    readonly blocklistSet: boolean,
  ) {}

  static create(props: FirewallPolicyProps): FirewallPolicy {
    assertPort(props.sshPort, 'sshPort');
    assertPort(props.portalPort, 'portalPort');
    assertPort(props.vpn.tunGwPort, 'vpn.tunGwPort');
    assertPort(props.vpn.tunPort, 'vpn.tunPort');
    assertPort(props.vpn.tapPort, 'vpn.tapPort');
    const seen = new Set<string>();
    for (const user of props.users) {
      // iptables chain names cap at 28 chars; "kobox-u-" leaves 20 for the
      // username — fail here, where the culprit can be named, instead of
      // letting every iptables-restore die opaquely
      if (user.username.value.length > 20) {
        throw new InvalidFirewallPolicyError(
          `username ${user.username.value} is too long for an iptables chain name (max 20)`,
        );
      }
      assertPort(user.rtorrentPort, `rtorrentPort of ${user.username.value}`);
      if (!Number.isInteger(user.uid) || user.uid < 1) {
        throw new InvalidFirewallPolicyError(
          `uid of ${user.username.value} must be a positive integer, got ${String(user.uid)}`,
        );
      }
      if (seen.has(user.username.value)) {
        throw new InvalidFirewallPolicyError(`duplicate user ${user.username.value}`);
      }
      seen.add(user.username.value);
    }
    const sorted = [...props.users].sort((a, b) =>
      a.username.value.localeCompare(b.username.value),
    );
    return new FirewallPolicy(
      props.sshPort,
      props.portalPort,
      props.vpn,
      sorted,
      props.blocklistSet,
    );
  }
}
