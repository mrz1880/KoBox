import { describe, expect, it } from 'vitest';
import { reservedPortsValue } from '../../../../src/domain/user/memberPortReservation.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';

describe('member port reservation', () => {
  it('should_reserve_a_lone_port_by_itself', () => {
    expect(reservedPortsValue([RtorrentPort.parse(45000)])).toBe('45000');
  });

  it('should_fold_consecutive_ports_into_one_range', () => {
    const ports = [45000, 45001, 45002].map((port) => RtorrentPort.parse(port));

    expect(reservedPortsValue(ports)).toBe('45000-45002');
  });

  it('should_list_the_ranges_in_ascending_order_whatever_order_the_ports_come_in', () => {
    // a member imported with their old ports sits apart from the pools
    const ports = [
      ScgiPort.parse(51102),
      RtorrentPort.parse(45001),
      ScgiPort.parse(36000),
      RtorrentPort.parse(45000),
      ScgiPort.parse(51101),
    ];

    expect(reservedPortsValue(ports)).toBe('36000,45000-45001,51101-51102');
  });
});
