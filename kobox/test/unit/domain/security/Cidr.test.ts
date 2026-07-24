import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Cidr, InvalidCidrError } from '../../../../src/domain/security/Cidr.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';

const ipIntArb = fc.nat({ max: 0xffffffff });
const prefixArb = fc.integer({ min: 0, max: 32 });

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

const canonicalCidrArb = fc
  .tuple(ipIntArb, prefixArb)
  .map(([ip, prefix]) => `${intToIp((ip & maskOf(prefix)) >>> 0)}/${String(prefix)}`);

describe('Cidr', () => {
  it('should_accept_canonical_ipv4_cidrs', () => {
    expect(Cidr.parse('192.0.2.0/24').value).toBe('192.0.2.0/24');
    expect(Cidr.parse('0.0.0.0/0').value).toBe('0.0.0.0/0');
    expect(Cidr.parse('198.51.100.7/32').value).toBe('198.51.100.7/32');
  });

  it('should_reject_non_canonical_cidrs_with_host_bits_set', () => {
    expect(() => Cidr.parse('192.0.2.1/24')).toThrow(InvalidCidrError);
    expect(() => Cidr.parse('10.0.0.1/8')).toThrow(InvalidCidrError);
  });

  it('should_reject_malformed_prefixes_and_addresses', () => {
    for (const raw of [
      '192.0.2.0/33',
      '192.0.2.0/-1',
      '192.0.2.0/2 4',
      '192.0.2.0',
      '192.0.2.0/24;id',
      '299.0.2.0/24',
      '192.0.2.0/024',
      '',
    ]) {
      expect(() => Cidr.parse(raw)).toThrow(InvalidCidrError);
    }
  });

  it('should_tell_whether_an_ip_is_contained', () => {
    const cidr = Cidr.parse('192.0.2.0/24');
    expect(cidr.contains(IpAddress.parse('192.0.2.42'))).toBe(true);
    expect(cidr.contains(IpAddress.parse('192.0.3.42'))).toBe(false);
    expect(Cidr.parse('0.0.0.0/0').contains(IpAddress.parse('203.0.113.9'))).toBe(true);
  });

  it('should_expose_network_netmask_and_gateway_for_config_rendering', () => {
    const cidr = Cidr.parse('10.0.1.0/24');
    expect(cidr.networkAddress).toBe('10.0.1.0');
    expect(cidr.netmask).toBe('255.255.255.0');
    expect(cidr.gatewayAddress).toBe('10.0.1.1');
    expect(Cidr.parse('192.0.2.64/26').netmask).toBe('255.255.255.192');
    expect(Cidr.parse('192.0.2.64/26').gatewayAddress).toBe('192.0.2.65');
  });

  it('should_build_a_host_cidr_from_an_ip', () => {
    expect(Cidr.host(IpAddress.parse('203.0.113.9')).value).toBe('203.0.113.9/32');
  });

  it('should_compare_by_value', () => {
    expect(Cidr.parse('192.0.2.0/24').equals(Cidr.parse('192.0.2.0/24'))).toBe(true);
    expect(Cidr.parse('192.0.2.0/24').equals(Cidr.parse('192.0.2.0/25'))).toBe(false);
  });

  it('property_parse_round_trips_on_canonical_cidrs', () => {
    fc.assert(
      fc.property(canonicalCidrArb, (raw) => {
        expect(Cidr.parse(Cidr.parse(raw).value).value).toBe(raw);
      }),
    );
  });

  it('property_contains_network_address_and_excludes_out_of_mask_ips', () => {
    fc.assert(
      fc.property(ipIntArb, fc.integer({ min: 1, max: 32 }), ipIntArb, (ip, prefix, other) => {
        const network = (ip & maskOf(prefix)) >>> 0;
        const cidr = Cidr.parse(`${intToIp(network)}/${String(prefix)}`);
        expect(cidr.contains(IpAddress.parse(intToIp(network)))).toBe(true);
        const sameNetwork = ((other & maskOf(prefix)) >>> 0) === network;
        expect(cidr.contains(IpAddress.parse(intToIp(other)))).toBe(sameNetwork);
      }),
    );
  });

  it('property_junk_with_forbidden_characters_always_throws', () => {
    const junkArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((raw) => !/^[0-9./]*$/.test(raw));
    fc.assert(
      fc.property(junkArb, (raw) => {
        expect(() => Cidr.parse(raw)).toThrow(InvalidCidrError);
      }),
    );
  });
});
