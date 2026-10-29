import { describe, expect, it } from 'vitest';
import { InvalidRemotePortError, RemotePort } from '../../../../src/domain/sync/RemotePort.js';

describe('RemotePort', () => {
  it('should_accept_the_first_and_the_last_tcp_port', () => {
    expect(RemotePort.parse(1).value).toBe(1);
    expect(RemotePort.parse(65535).value).toBe(65535);
  });

  it('should_refuse_a_port_just_outside_the_tcp_range', () => {
    expect(() => RemotePort.parse(0)).toThrow(InvalidRemotePortError);
    expect(() => RemotePort.parse(65536)).toThrow(InvalidRemotePortError);
  });

  it('should_refuse_a_fractional_port_and_name_it_in_the_error', () => {
    expect(() => RemotePort.parse(22.5)).toThrow(
      'invalid remote port 22.5: expected an integer in [1, 65535]',
    );
  });

  it('should_compare_by_value', () => {
    expect(RemotePort.parse(22).equals(RemotePort.parse(22))).toBe(true);
    expect(RemotePort.parse(22).equals(RemotePort.parse(2222))).toBe(false);
  });
});
