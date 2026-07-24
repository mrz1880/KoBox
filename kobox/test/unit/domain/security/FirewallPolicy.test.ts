import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Cidr } from '../../../../src/domain/security/Cidr.js';
import {
  FirewallPolicy,
  InvalidFirewallPolicyError,
  type FirewallUser,
} from '../../../../src/domain/security/FirewallPolicy.js';
import { renderFirewallRules } from '../../../../src/domain/security/rendering.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { Username } from '../../../../src/domain/user/Username.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/security');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

const users: readonly FirewallUser[] = [
  {
    username: Username.parse('bob'),
    uid: 1002,
    rtorrentPort: 45002,
    addresses: [IpAddress.parse('198.51.100.9')],
  },
  {
    username: Username.parse('alice'),
    uid: 1001,
    rtorrentPort: 45001,
    addresses: [IpAddress.parse('198.51.100.7'), IpAddress.parse('192.0.2.42')],
  },
];

const settings = {
  sshPort: 22,
  portalPort: 8189,
  vpn: {
    tunGwPort: 8193,
    tunPort: 8194,
    tapPort: 8195,
    tunGwSubnet: Cidr.parse('10.0.0.0/24'),
    tunSubnet: Cidr.parse('10.0.1.0/24'),
    tapSubnet: Cidr.parse('10.0.2.0/24'),
  },
} as const;

function policyWith(policyUsers: readonly FirewallUser[]): FirewallPolicy {
  return FirewallPolicy.create({ ...settings, users: policyUsers });
}

describe('FirewallPolicy', () => {
  it('should_reject_out_of_range_ports_and_uids', () => {
    expect(() => FirewallPolicy.create({ ...settings, sshPort: 0, users: [] })).toThrow(
      InvalidFirewallPolicyError,
    );
    expect(() => FirewallPolicy.create({ ...settings, portalPort: 65536, users: [] })).toThrow(
      InvalidFirewallPolicyError,
    );
    expect(() =>
      policyWith([{ ...users[0]!, uid: 0 }]),
    ).toThrow(InvalidFirewallPolicyError);
    expect(() =>
      policyWith([{ ...users[0]!, rtorrentPort: 1.5 }]),
    ).toThrow(InvalidFirewallPolicyError);
  });

  it('should_reject_duplicate_usernames', () => {
    expect(() => policyWith([users[0]!, users[0]!])).toThrow(InvalidFirewallPolicyError);
  });
});

describe('renderFirewallRules', () => {
  it('should_render_the_complete_ruleset_deterministically', () => {
    const file = renderFirewallRules(policyWith(users));
    expect(file.path).toBe('/etc/kobox/firewall.rules');
    expect(file.mode).toBe('0600');
    expect(file.owner).toBe('root');
    expectGolden('firewall.rules.golden', file.content);
  });

  it('should_always_preserve_loopback_established_and_ssh_even_with_no_users', () => {
    // Anti-lockout by construction: there is no API to omit these three rules.
    const content = renderFirewallRules(policyWith([])).content;
    expect(content).toContain('-A INPUT -i lo -j ACCEPT');
    expect(content).toContain('-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT');
    expect(content).toContain('-A INPUT -p tcp --dport 22 -j ACCEPT');
    const lines = content.split('\n');
    const sshIndex = lines.findIndex((line) => line === '-A INPUT -p tcp --dport 22 -j ACCEPT');
    const loIndex = lines.findIndex((line) => line === '-A INPUT -i lo -j ACCEPT');
    expect(loIndex).toBeGreaterThan(-1);
    expect(loIndex).toBeLessThan(sshIndex);
  });

  it('should_default_deny_input_and_forward_but_never_block_output', () => {
    // Issue #120: outbound is metered, never blocked — tracker announces and
    // blocklist downloads cannot be broken by the firewall.
    const content = renderFirewallRules(policyWith(users)).content;
    expect(content).toContain(':INPUT DROP [0:0]');
    expect(content).toContain(':FORWARD DROP [0:0]');
    expect(content).toContain(':OUTPUT ACCEPT [0:0]');
    expect(content).not.toMatch(/-A OUTPUT .*-j (DROP|REJECT)/);
  });

  it('should_declare_the_pgl_seam_chain_and_jump_to_it_after_the_lifelines', () => {
    const lines = renderFirewallRules(policyWith(users)).content.split('\n');
    expect(lines).toContain(':pgl_in - [0:0]');
    const pglIndex = lines.indexOf('-A INPUT -j pgl_in');
    const establishedIndex = lines.indexOf(
      '-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
    );
    expect(pglIndex).toBeGreaterThan(establishedIndex);
  });

  it('should_trust_declared_user_addresses_before_the_pgl_filter', () => {
    const lines = renderFirewallRules(policyWith(users)).content.split('\n');
    const trusted = lines.indexOf(
      '-A INPUT -s 192.0.2.42 -m comment --comment "kobox:trusted:alice" -j ACCEPT',
    );
    const pglIndex = lines.indexOf('-A INPUT -j pgl_in');
    expect(trusted).toBeGreaterThan(-1);
    expect(trusted).toBeLessThan(pglIndex);
  });

  it('should_route_each_user_rtorrent_port_through_its_chain_with_metering', () => {
    const content = renderFirewallRules(policyWith(users)).content;
    expect(content).toContain('-A INPUT -p tcp --dport 45001 -j kobox-u-alice');
    expect(content).toContain('-A kobox-u-alice -j kobox-meter-in');
    expect(content).toContain('-A kobox-u-alice -j ACCEPT');
    expect(content).toContain(
      '-A kobox-meter-in -p tcp --dport 45001 -m comment --comment "kobox:ingress:alice" -j RETURN',
    );
    expect(content).toContain(
      '-A kobox-meter-out -m owner --uid-owner 1001 -m comment --comment "kobox:egress:alice" -j RETURN',
    );
  });

  it('should_masquerade_only_the_with_gateway_vpn_subnet', () => {
    const content = renderFirewallRules(policyWith(users)).content;
    expect(content).toContain('*nat');
    expect(content).toContain('-A POSTROUTING -s 10.0.0.0/24 ! -d 10.0.0.0/24 -j MASQUERADE');
    expect(content).not.toContain('-A POSTROUTING -s 10.0.1.0/24');
    // mangle is owned by the shaper: a firewall re-apply must not wipe live throttles
    expect(content).not.toContain('*mangle');
  });

  it('should_render_identically_regardless_of_user_input_order', () => {
    const forward = renderFirewallRules(policyWith(users)).content;
    const reversed = renderFirewallRules(policyWith([...users].reverse())).content;
    expect(reversed).toBe(forward);
  });
});
