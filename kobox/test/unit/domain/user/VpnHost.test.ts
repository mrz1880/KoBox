import { describe, expect, it } from 'vitest';
import {
  InvalidVpnHostError,
  VpnAddressesExhaustedError,
  VpnHost,
} from '../../../../src/domain/user/VpnHost.js';

describe('VpnHost', () => {
  it('should_accept_every_host_of_a_tunnel_but_the_gateway_and_broadcast', () => {
    expect(VpnHost.parse(2).value).toBe(2);
    expect(VpnHost.parse(254).value).toBe(254);
    for (const raw of [0, 1, 255, 3.5, -4]) {
      expect(() => VpnHost.parse(raw)).toThrow(InvalidVpnHostError);
    }
  });

  it('should_hand_out_the_lowest_number_nobody_holds', () => {
    expect(VpnHost.lowestFree([]).value).toBe(2);
    expect(VpnHost.lowestFree([VpnHost.parse(2), VpnHost.parse(4)]).value).toBe(3);
  });

  it('should_say_so_when_every_address_is_taken', () => {
    const all = Array.from({ length: 253 }, (_unused, index) => VpnHost.parse(index + 2));

    expect(() => VpnHost.lowestFree(all)).toThrow(VpnAddressesExhaustedError);
  });
});
