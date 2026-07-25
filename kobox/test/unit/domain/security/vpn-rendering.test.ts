import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Cidr } from '../../../../src/domain/security/Cidr.js';
import { DynDnsHost } from '../../../../src/domain/security/DynDnsHost.js';
import {
  VPN_VARIANTS,
  renderOpenVpnClientProfile,
  renderOpenVpnServer,
  type VpnClientMaterial,
  type VpnServerPaths,
} from '../../../../src/domain/security/vpn.js';
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

const vpn = {
  tunGwPort: 8193,
  tunPort: 8194,
  tapPort: 8195,
  tunGwSubnet: Cidr.parse('10.0.0.0/24'),
  tunSubnet: Cidr.parse('10.0.1.0/24'),
  tapSubnet: Cidr.parse('10.0.2.0/24'),
} as const;

const pki: VpnServerPaths = {
  caCrt: '/etc/openvpn/kobox-pki/ca.crt',
  serverCrt: '/etc/openvpn/kobox-pki/issued/server.crt',
  serverKey: '/etc/openvpn/kobox-pki/private/server.key',
};

const material: VpnClientMaterial = {
  caCrt: '-----BEGIN CERTIFICATE-----\nCA-FIXTURE\n-----END CERTIFICATE-----',
  userCrt: '-----BEGIN CERTIFICATE-----\nALICE-FIXTURE\n-----END CERTIFICATE-----',
  userKey: '-----BEGIN PRIVATE KEY-----\nALICE-KEY-FIXTURE\n-----END PRIVATE KEY-----',
};

describe('renderOpenVpnServer', () => {
  it('should_render_the_three_variants_as_golden_files', () => {
    for (const variant of VPN_VARIANTS) {
      const file = renderOpenVpnServer(variant, vpn, pki);
      expect(file.path).toBe(`/etc/openvpn/server/kobox-${variant}.conf`);
      expect(file.mode).toBe('0600');
      expectGolden(`openvpn-${variant}.conf.golden`, file.content);
    }
  });

  it('should_never_enable_compression_voracle', () => {
    for (const variant of VPN_VARIANTS) {
      const content = renderOpenVpnServer(variant, vpn, pki).content;
      expect(content).not.toContain('comp-lzo');
      expect(content).not.toMatch(/^compress/m);
    }
  });

  it('should_use_ec_key_exchange_with_dh_none', () => {
    // the Phase 4 PKI bootstrap is EC (EASYRSA_ALGO=ec): no dh.pem exists,
    // OpenVPN negotiates ECDHE — `dh none` is the matching server setting
    for (const variant of VPN_VARIANTS) {
      const content = renderOpenVpnServer(variant, vpn, pki).content;
      expect(content).toContain('dh none');
      expect(content).not.toContain('dh.pem');
    }
  });

  it('should_push_redirect_gateway_only_on_the_gw_variant', () => {
    const gw = renderOpenVpnServer('tun-gw', vpn, pki).content;
    const plain = renderOpenVpnServer('tun', vpn, pki).content;
    const tap = renderOpenVpnServer('tap', vpn, pki).content;
    expect(gw).toContain('push "redirect-gateway def1 bypass-dhcp"');
    expect(plain).not.toContain('redirect-gateway');
    expect(tap).not.toContain('redirect-gateway');
  });

  it('should_push_the_tunnel_local_dns_on_every_variant', () => {
    expect(renderOpenVpnServer('tun-gw', vpn, pki).content).toContain(
      'push "dhcp-option DNS 10.0.0.1"',
    );
    expect(renderOpenVpnServer('tun', vpn, pki).content).toContain(
      'push "dhcp-option DNS 10.0.1.1"',
    );
    expect(renderOpenVpnServer('tap', vpn, pki).content).toContain(
      'push "dhcp-option DNS 10.0.2.1"',
    );
  });

  it('should_use_the_variant_port_dev_and_subnet', () => {
    const tap = renderOpenVpnServer('tap', vpn, pki).content;
    expect(tap).toContain('port 8195');
    expect(tap).toContain('dev tap');
    expect(tap).toContain('server 10.0.2.0 255.255.255.0');
  });
});

describe('renderOpenVpnClientProfile', () => {
  const remote = DynDnsHost.parse('seedbox.example.org');

  it('should_render_a_per_user_profile_with_inline_material', () => {
    const file = renderOpenVpnClientProfile(Username.parse('alice'), 'tun-gw', remote, vpn, material);
    expect(file.path).toBe('/etc/kobox/vpn-profiles/alice/kobox-tun-gw.ovpn');
    expect(file.mode).toBe('0640');
    expect(file.group).toBe('alice');
    expect(file.content).toContain('remote seedbox.example.org 8193');
    expect(file.content).toContain('<ca>');
    expect(file.content).toContain('ALICE-FIXTURE');
    expect(file.content).not.toContain('comp-lzo');
    expectGolden('openvpn-client.ovpn.golden', file.content);
  });

  it('should_match_dev_and_port_to_the_variant', () => {
    const tap = renderOpenVpnClientProfile(Username.parse('bob'), 'tap', remote, vpn, material);
    expect(tap.content).toContain('dev tap');
    expect(tap.content).toContain('remote seedbox.example.org 8195');
    expect(tap.path).toBe('/etc/kobox/vpn-profiles/bob/kobox-tap.ovpn');
  });
});
