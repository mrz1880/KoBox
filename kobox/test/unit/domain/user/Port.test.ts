import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidPortError,
  ProxyPort,
  RtorrentPort,
  ScgiPort,
} from '../../../../src/domain/user/Port.js';

describe('Port', () => {
  it('should_accept_the_full_tcp_range_1_to_65535', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 65535 }), (n) => {
        expect(ScgiPort.parse(n).value).toBe(n);
      }),
    );
  });

  it('should_reject_out_of_range_and_non_integer_ports', () => {
    for (const raw of [0, -1, 65536, 1.5, Number.NaN]) {
      expect(() => ScgiPort.parse(raw)).toThrow(InvalidPortError);
      expect(() => RtorrentPort.parse(raw)).toThrow(InvalidPortError);
      expect(() => ProxyPort.parse(raw)).toThrow(InvalidPortError);
    }
  });

  it('should_compare_by_value_within_the_same_kind', () => {
    expect(ScgiPort.parse(51101).equals(ScgiPort.parse(51101))).toBe(true);
    expect(ScgiPort.parse(51101).equals(ScgiPort.parse(51102))).toBe(false);
  });

  it('should_brand_port_kinds_as_distinct_types', () => {
    const scgi: ScgiPort = ScgiPort.parse(51101);
    // @ts-expect-error a ScgiPort is not assignable to a RtorrentPort
    const wrong: RtorrentPort = scgi;
    expect(wrong.value).toBe(51101);
  });
});
