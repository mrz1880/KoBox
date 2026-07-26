import type { RenderedFile } from '../shared/files.js';
import type { Username } from '../user/Username.js';
import type { Cidr } from './Cidr.js';
import type { DynDnsHost } from './DynDnsHost.js';
import type { VpnSettings } from './FirewallPolicy.js';

// The three legacy variants, kept for client compatibility. TAP runs in
// server-subnet mode (no bridge): a seedbox has no LAN to bridge into, which
// removes the whole br0/OpenVPN-Bridge.bsh machinery.
export const VPN_VARIANTS = ['tun-gw', 'tun', 'tap'] as const;
export type VpnVariant = (typeof VPN_VARIANTS)[number];

// Where client profiles are rendered; deprovisioning removes the whole
// per-user subtree (the .ovpn embeds the private key).
export const VPN_PROFILES_BASE = '/etc/kobox/vpn-profiles';

// The non-root system group the portal process runs under; it owns the
// rendered .ovpn profiles so the portal can stream them (Phase 6).
export const PORTAL_GROUP = 'kobox-portal';

// EC PKI (easy-rsa EASYRSA_ALGO=ec): no dh.pem exists anywhere — the server
// runs `dh none` and OpenVPN negotiates ECDHE.
export interface VpnServerPaths {
  readonly caCrt: string;
  readonly serverCrt: string;
  readonly serverKey: string;
  // The easy-rsa CRL: crl-verify makes each server reject a revoked client on
  // its next connection. The file must always exist (ensurePki gen-crl seeds an
  // empty one) or OpenVPN refuses to start.
  readonly crlPem: string;
}

export interface VpnClientMaterial {
  readonly caCrt: string;
  readonly userCrt: string;
  readonly userKey: string;
}

interface VariantShape {
  readonly dev: 'tun' | 'tap';
  readonly redirectGateway: boolean;
}

const VARIANT_SHAPES: Record<VpnVariant, VariantShape> = {
  'tun-gw': { dev: 'tun', redirectGateway: true },
  tun: { dev: 'tun', redirectGateway: false },
  tap: { dev: 'tap', redirectGateway: false },
};

function portOf(variant: VpnVariant, vpn: VpnSettings): number {
  if (variant === 'tun-gw') {
    return vpn.tunGwPort;
  }
  return variant === 'tun' ? vpn.tunPort : vpn.tapPort;
}

function subnetOf(variant: VpnVariant, vpn: VpnSettings): Cidr {
  if (variant === 'tun-gw') {
    return vpn.tunGwSubnet;
  }
  return variant === 'tun' ? vpn.tunSubnet : vpn.tapSubnet;
}

// Hardened shared base: AEAD ciphers only, no compression (VORACLE), dropped
// privileges. Applies to servers and clients alike.
const COMMON_CRYPTO = ['data-ciphers AES-256-GCM:AES-128-GCM', 'auth SHA256'];

export function renderOpenVpnServer(
  variant: VpnVariant,
  vpn: VpnSettings,
  pki: VpnServerPaths,
): RenderedFile {
  const shape = VARIANT_SHAPES[variant];
  const subnet = subnetOf(variant, vpn);
  const push = [
    ...(shape.redirectGateway
      ? ['push "redirect-gateway def1 bypass-dhcp"', 'push "block-outside-dns"']
      : []),
    `push "dhcp-option DNS ${subnet.gatewayAddress}"`,
  ];
  return {
    path: `/etc/openvpn/server/kobox-${variant}.conf`,
    content: [
      `# KoBox-managed OpenVPN server (${variant}) — DO NOT EDIT (rendered declaratively).`,
      `port ${String(portOf(variant, vpn))}`,
      'proto udp4',
      `dev ${shape.dev}`,
      'topology subnet',
      `server ${subnet.networkAddress} ${subnet.netmask}`,
      `ca ${pki.caCrt}`,
      `cert ${pki.serverCrt}`,
      `key ${pki.serverKey}`,
      `crl-verify ${pki.crlPem}`,
      'dh none',
      ...COMMON_CRYPTO,
      'keepalive 10 120',
      'persist-key',
      'persist-tun',
      'user nobody',
      'group nogroup',
      `status /var/log/openvpn/kobox-${variant}-status.log`,
      'verb 3',
      ...push,
      '',
    ].join('\n'),
    mode: '0600',
    owner: 'root',
    group: 'root',
  };
}

export function renderOpenVpnClientProfile(
  username: Username,
  variant: VpnVariant,
  remote: DynDnsHost,
  vpn: VpnSettings,
  material: VpnClientMaterial,
): RenderedFile {
  const shape = VARIANT_SHAPES[variant];
  return {
    path: `${VPN_PROFILES_BASE}/${username.value}/kobox-${variant}.ovpn`,
    content: [
      `# KoBox-managed OpenVPN client profile for ${username.value} (${variant}) — DO NOT EDIT.`,
      'client',
      `remote ${remote.value} ${String(portOf(variant, vpn))}`,
      'proto udp4',
      `dev ${shape.dev}`,
      'resolv-retry infinite',
      'nobind',
      'persist-key',
      'persist-tun',
      'remote-cert-tls server',
      ...COMMON_CRYPTO,
      'verb 3',
      '<ca>',
      material.caCrt,
      '</ca>',
      '<cert>',
      material.userCrt,
      '</cert>',
      '<key>',
      material.userKey,
      '</key>',
      '',
    ].join('\n'),
    mode: '0640',
    owner: 'root',
    // the portal (kobox-portal group) streams these on /access/ovpn; the
    // chrooted user never reaches the filesystem path directly (Phase 6)
    group: PORTAL_GROUP,
  };
}
