import { describe, expect, it } from 'vitest';
import { QuotaPressure } from '../../../../src/domain/space/QuotaPressure.js';
import { Quota } from '../../../../src/domain/user/Quota.js';

describe('QuotaPressure', () => {
  it.each([
    { usedGib: 79, allowanceGib: 100, pressure: 'relaxed' },
    { usedGib: 80, allowanceGib: 100, pressure: 'filling' },
    { usedGib: 89, allowanceGib: 100, pressure: 'filling' },
    { usedGib: 90, allowanceGib: 100, pressure: 'critical' },
    { usedGib: 100, allowanceGib: 100, pressure: 'critical' },
    // no allowance at all leaves no room for anything, even with nothing stored
    { usedGib: 0, allowanceGib: 0, pressure: 'critical' },
  ])(
    'should_read_$usedGib-of-$allowanceGib-GiB_as_$pressure',
    ({ usedGib, allowanceGib, pressure }) => {
      expect(QuotaPressure.of(Quota.gib(usedGib), Quota.gib(allowanceGib))).toBe(pressure);
    },
  );

  it('should_aim_a_cleanup_at_the_usage_where_filling_starts', () => {
    expect(QuotaPressure.targetUsage(Quota.gib(100)).toGib()).toBe(80);
  });
});
