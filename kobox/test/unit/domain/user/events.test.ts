import { describe, expect, it } from 'vitest';
import { concernsEveryAdmin, type UserEvent } from '../../../../src/domain/user/events.js';

describe('which account events every admin hears about', () => {
  it('should_tell_every_admin_who_joins_who_leaves_and_who_asked_for_a_new_password', () => {
    const event = (type: UserEvent['type']) => ({ type, username: 'alice' });

    expect(
      (['UserCreated', 'UserDeleted', 'PasswordResetRequested'] as const).map((type) =>
        concernsEveryAdmin(event(type)),
      ),
    ).toEqual([true, true, true]);
    // what follows from an admin's own action stays with the operator's channels
    expect(
      (['PasswordChanged', 'UserSuspended', 'UserResumed'] as const).map((type) =>
        concernsEveryAdmin(event(type)),
      ),
    ).toEqual([false, false, false]);
  });
});
