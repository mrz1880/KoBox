import type { RenderedFile } from '../shared/files.js';
import type { FirewallPolicy, FirewallUser } from './FirewallPolicy.js';

// Pure, deterministic render of the complete firewall desired state as one
// iptables-restore document (never incremental -A over a live table). The
// mangle table is deliberately absent: it belongs to the shaper, so a firewall
// re-apply keeps live throttles.

function ipSortKey(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function chainOf(user: FirewallUser): string {
  return `kobox-u-${user.username.value}`;
}

function trustedRules(users: readonly FirewallUser[]): readonly string[] {
  return users.flatMap((user) =>
    [...user.addresses]
      .sort((a, b) => ipSortKey(a.value) - ipSortKey(b.value))
      .map(
        (ip) =>
          `-A INPUT -s ${ip.value} -m comment --comment "kobox:trusted:${user.username.value}" -j ACCEPT`,
      ),
  );
}

export function renderFirewallRules(policy: FirewallPolicy): RenderedFile {
  const { users, vpn } = policy;
  const subnets = [vpn.tunGwSubnet, vpn.tunSubnet, vpn.tapSubnet];

  const filter = [
    '*filter',
    ':INPUT DROP [0:0]',
    ':FORWARD DROP [0:0]',
    ':OUTPUT ACCEPT [0:0]',
    ':pgl_in - [0:0]',
    ':kobox-meter-in - [0:0]',
    ':kobox-meter-out - [0:0]',
    ...users.map((user) => `:${chainOf(user)} - [0:0]`),
    // lifelines first — these three lines are the anti-lockout invariant
    '-A INPUT -i lo -j ACCEPT',
    '-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
    '-A INPUT -p icmp -j ACCEPT',
    ...trustedRules(users),
    '-A INPUT -j pgl_in',
    `-A INPUT -p tcp --dport ${String(policy.sshPort)} -j ACCEPT`,
    `-A INPUT -p tcp --dport ${String(policy.portalPort)} -j ACCEPT`,
    '-A INPUT -p tcp --dport 80 -j ACCEPT',
    '-A INPUT -p tcp --dport 443 -j ACCEPT',
    `-A INPUT -p udp --dport ${String(vpn.tunGwPort)} -j ACCEPT`,
    `-A INPUT -p udp --dport ${String(vpn.tunPort)} -j ACCEPT`,
    `-A INPUT -p udp --dport ${String(vpn.tapPort)} -j ACCEPT`,
    // VPN clients resolve through the box (bind on the tunnel address)
    ...subnets.flatMap((subnet) => [
      `-A INPUT -s ${subnet.value} -p udp --dport 53 -j ACCEPT`,
      `-A INPUT -s ${subnet.value} -p tcp --dport 53 -j ACCEPT`,
    ]),
    ...users.map(
      (user) => `-A INPUT -p tcp --dport ${String(user.rtorrentPort)} -j ${chainOf(user)}`,
    ),
    '-A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
    ...subnets.map((subnet) => `-A FORWARD -s ${subnet.value} -j ACCEPT`),
    '-A OUTPUT -j kobox-meter-out',
    ...users.flatMap((user) => [`-A ${chainOf(user)} -j kobox-meter-in`, `-A ${chainOf(user)} -j ACCEPT`]),
    ...users.map(
      (user) =>
        `-A kobox-meter-in -p tcp --dport ${String(user.rtorrentPort)} -m comment --comment "kobox:ingress:${user.username.value}" -j RETURN`,
    ),
    ...users.map(
      (user) =>
        `-A kobox-meter-out -m owner --uid-owner ${String(user.uid)} -m comment --comment "kobox:egress:${user.username.value}" -j RETURN`,
    ),
    'COMMIT',
  ];

  const nat = [
    '*nat',
    ':PREROUTING ACCEPT [0:0]',
    ':INPUT ACCEPT [0:0]',
    ':OUTPUT ACCEPT [0:0]',
    ':POSTROUTING ACCEPT [0:0]',
    `-A POSTROUTING -s ${vpn.tunGwSubnet.value} ! -d ${vpn.tunGwSubnet.value} -j MASQUERADE`,
    'COMMIT',
  ];

  return {
    path: '/etc/kobox/firewall.rules',
    content: [
      '# KoBox-managed firewall — DO NOT EDIT (rendered declaratively).',
      '# Applied atomically via iptables-restore; pgl chains reload after apply.',
      ...filter,
      ...nat,
      '',
    ].join('\n'),
    mode: '0600',
    owner: 'root',
    group: 'root',
  };
}
