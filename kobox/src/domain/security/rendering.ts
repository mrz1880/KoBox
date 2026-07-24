import type { RenderedFile } from '../shared/files.js';
import type { IpAddress } from '../shared/IpAddress.js';
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

const ROOT_FILE = { mode: '0644', owner: 'root', group: 'root' } as const;

// The jail no stock fail2ban setup has: it counts *accepted* publickey logins.
// A valid key makes a flood invisible to every failure-based jail (the user-h
// vector: 1979 connections/day) — abnormal success frequency IS the signal.
export function renderFail2banJails(
  ignoreIps: readonly IpAddress[],
  sshPort: number,
): RenderedFile {
  const sorted = [...ignoreIps].sort((a, b) => ipSortKey(a.value) - ipSortKey(b.value));
  const ignoreLine = ['127.0.0.1/8', '::1', ...sorted.map((ip) => ip.value)].join(' ');
  return {
    path: '/etc/fail2ban/jail.d/kobox.local',
    content: [
      '# KoBox-managed fail2ban jails — DO NOT EDIT (rendered declaratively).',
      '[DEFAULT]',
      `ignoreip = ${ignoreLine}`,
      '',
      '[sshd]',
      'enabled = true',
      'backend = systemd',
      `port = ${String(sshPort)}`,
      '',
      '[nginx-http-auth]',
      'enabled = true',
      '',
      '[kobox-publickey-flood]',
      'enabled = true',
      'backend = systemd',
      'filter = kobox-publickey-flood',
      `port = ${String(sshPort)}`,
      'maxretry = 30',
      'findtime = 3600',
      'bantime = 3600',
      '',
    ].join('\n'),
    ...ROOT_FILE,
  };
}

export function renderPublickeyFloodFilter(): RenderedFile {
  return {
    path: '/etc/fail2ban/filter.d/kobox-publickey-flood.conf',
    content: [
      '# KoBox — bans a flood of *successful* publickey logins (abnormal auth',
      '# frequency with a valid key, invisible to failure-based jails).',
      '[Definition]',
      'journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd',
      String.raw`failregex = ^.*Accepted publickey for \S+ from <HOST> port \d+.*$`,
      'ignoreregex =',
      '',
    ].join('\n'),
    ...ROOT_FILE,
  };
}
