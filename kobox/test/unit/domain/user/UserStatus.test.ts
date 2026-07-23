import { describe, expect, it } from 'vitest';
import { InvalidUserStatusError, UserStatus } from '../../../../src/domain/user/UserStatus.js';

describe('UserStatus', () => {
  it('should_parse_the_closed_set_active_suspended', () => {
    expect(UserStatus.parse('active')).toBe(UserStatus.active);
    expect(UserStatus.parse('suspended')).toBe(UserStatus.suspended);
  });

  it('should_reject_unknown_statuses', () => {
    expect(() => UserStatus.parse('banned')).toThrow(InvalidUserStatusError);
  });

  it('should_know_whether_it_is_suspended', () => {
    expect(UserStatus.active.isSuspended()).toBe(false);
    expect(UserStatus.suspended.isSuspended()).toBe(true);
  });
});
