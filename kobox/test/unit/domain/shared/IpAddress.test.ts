import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidIpAddressError, IpAddress } from '../../../../src/domain/shared/IpAddress.js';

const octetArb = fc.integer({ min: 0, max: 255 });
const validIpArb = fc
  .tuple(octetArb, octetArb, octetArb, octetArb)
  .map((octets) => octets.join('.'));

describe('IpAddress', () => {
  it('should_accept_dotted_quad_ipv4', () => {
    expect(IpAddress.parse('192.0.2.10').value).toBe('192.0.2.10');
    expect(IpAddress.parse('0.0.0.0').value).toBe('0.0.0.0');
    expect(IpAddress.parse('255.255.255.255').value).toBe('255.255.255.255');
  });

  it('should_reject_out_of_range_octets_and_malformed_input', () => {
    for (const raw of [
      '256.0.0.1',
      '1.2.3',
      '1.2.3.4.5',
      '01.2.3.4',
      '+1.2.3.4',
      '1.2.3.4 ',
      ' 1.2.3.4',
      '1.2.3.4;id',
      'a.b.c.d',
      '',
    ]) {
      expect(() => IpAddress.parse(raw)).toThrow(InvalidIpAddressError);
    }
  });

  it('should_flag_loopback_and_unspecified_as_unusable', () => {
    // the legacy tracker pipeline skips these two (funcs_GetTrackersCert)
    expect(IpAddress.parse('127.0.0.1').isUsable).toBe(false);
    expect(IpAddress.parse('0.0.0.0').isUsable).toBe(false);
    expect(IpAddress.parse('192.0.2.10').isUsable).toBe(true);
  });

  it('should_tell_an_address_internet_traffic_can_come_from_from_one_it_cannot', () => {
    // private, loopback, link-local, carrier-grade NAT, multicast and reserved
    // ranges never show up as the source of a connection from the internet
    for (const raw of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.20',
      '127.0.0.1',
      '0.0.0.0',
      '169.254.1.1',
      '100.64.0.1',
      '100.127.255.255',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(IpAddress.parse(raw).isPublic, raw).toBe(false);
    }
    for (const raw of ['198.51.100.40', '172.32.0.1', '100.128.0.1', '9.255.255.255', '11.0.0.1']) {
      expect(IpAddress.parse(raw).isPublic, raw).toBe(true);
    }
  });

  it('property_any_valid_dotted_quad_parses_and_round_trips', () => {
    fc.assert(
      fc.property(validIpArb, (raw) => {
        expect(IpAddress.parse(raw).value).toBe(raw);
      }),
    );
  });

  it('should_compare_by_value', () => {
    expect(IpAddress.parse('192.0.2.10').equals(IpAddress.parse('192.0.2.10'))).toBe(true);
    expect(IpAddress.parse('192.0.2.10').equals(IpAddress.parse('192.0.2.11'))).toBe(false);
  });
});
