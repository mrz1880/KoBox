import { describe, expect, it } from 'vitest';
import { AccountType } from '../../../../src/domain/user/AccountType.js';
import { EmailAddress } from '../../../../src/domain/user/EmailAddress.js';
import { ProxyPort, RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { SeedboxUser } from '../../../../src/domain/user/SeedboxUser.js';
import { UserStatus } from '../../../../src/domain/user/UserStatus.js';
import { Username } from '../../../../src/domain/user/Username.js';

function aUserCreation() {
  return SeedboxUser.create({
    username: Username.parse('alice'),
    email: EmailAddress.parse('alice@example.org'),
    accountType: AccountType.normal,
    quota: Quota.gib(412),
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45000),
    proxyPort: ProxyPort.parse(8080),
  });
}

describe('SeedboxUser', () => {
  it('should_be_created_active_and_emit_UserCreated', () => {
    const { user, event } = aUserCreation();

    expect(user.status).toBe(UserStatus.active);
    expect(event).toEqual({ type: 'UserCreated', username: 'alice' });
  });

  it('should_suspend_by_returning_a_new_state_and_an_event', () => {
    const { user } = aUserCreation();

    const { user: suspended, event } = user.suspend();

    expect(suspended.status).toBe(UserStatus.suspended);
    expect(user.status).toBe(UserStatus.active); // original untouched (immutable)
    expect(event).toEqual({ type: 'UserSuspended', username: 'alice' });
  });

  it('should_make_suspend_idempotent', () => {
    const { user } = aUserCreation();
    const once = user.suspend().user;

    const twice = once.suspend();

    expect(twice.user).toBe(once);
    expect(twice.event).toBeUndefined();
  });

  it('should_resume_back_to_the_exact_previous_state', () => {
    const { user } = aUserCreation();

    const resumed = user.suspend().user.resume();

    expect(resumed.user.status).toBe(UserStatus.active);
    expect(resumed.user.quota.equals(user.quota)).toBe(true);
    expect(resumed.user.scgiPort.equals(user.scgiPort)).toBe(true);
    expect(resumed.event).toEqual({ type: 'UserResumed', username: 'alice' });
  });

  it('should_make_resume_idempotent_on_active_users', () => {
    const { user } = aUserCreation();

    const resumed = user.resume();

    expect(resumed.user).toBe(user);
    expect(resumed.event).toBeUndefined();
  });

  it('should_change_quota_immutably', () => {
    const { user } = aUserCreation();

    const bigger = user.withQuota(Quota.gib(500));

    expect(bigger.quota.toGib()).toBe(500);
    expect(user.quota.toGib()).toBe(412);
    expect(bigger.username.equals(user.username)).toBe(true);
  });
});
