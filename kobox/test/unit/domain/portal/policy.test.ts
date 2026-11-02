import { describe, expect, it } from 'vitest';
import { lockExpiry, sessionExpiry } from '../../../../src/domain/portal/policy.js';

describe('portal auth policy', () => {
  it('should_keep_a_session_open_for_a_week', () => {
    expect(sessionExpiry('2026-10-24 10:00:00')).toBe('2026-10-31 10:00:00');
  });

  it('should_lock_an_account_for_a_quarter_of_an_hour', () => {
    expect(lockExpiry('2026-10-24 10:00:00')).toBe('2026-10-24 10:15:00');
  });
});
