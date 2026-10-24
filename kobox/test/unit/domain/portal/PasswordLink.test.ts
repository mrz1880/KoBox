import { describe, expect, it } from 'vitest';
import {
  PasswordLink,
  PasswordLinkClosedError,
} from '../../../../src/domain/portal/PasswordLink.js';
import { Username } from '../../../../src/domain/user/Username.js';

const alice = Username.parse('alice');
const issuedAt = '2026-10-24 10:00:00';

function issue(purpose: 'invitation' | 'reset'): PasswordLink {
  return PasswordLink.issue({ username: alice, purpose, tokenHash: 'a'.repeat(64), now: issuedAt });
}

describe('PasswordLink', () => {
  it('should_give_an_invitation_a_week_to_be_read', () => {
    const link = issue('invitation');

    expect(link.expiresAt).toBe('2026-10-31 10:00:00');
    expect(link.isOpen('2026-10-31 09:59:59')).toBe(true);
    expect(link.isOpen('2026-10-31 10:00:00')).toBe(false);
  });

  it('should_give_a_reset_an_hour', () => {
    const link = issue('reset');

    expect(link.expiresAt).toBe('2026-10-24 11:00:00');
    expect(link.isOpen('2026-10-24 10:59:59')).toBe(true);
    expect(link.isOpen('2026-10-24 11:00:01')).toBe(false);
  });

  it('should_open_only_once', () => {
    const used = issue('reset').use('2026-10-24 10:05:00');

    expect(used.usedAt).toBe('2026-10-24 10:05:00');
    expect(used.isOpen('2026-10-24 10:06:00')).toBe(false);
    expect(() => used.use('2026-10-24 10:06:00')).toThrow(PasswordLinkClosedError);
  });

  it('should_refuse_to_be_used_once_expired', () => {
    expect(() => issue('reset').use('2026-10-24 12:00:00')).toThrow(PasswordLinkClosedError);
  });

  it('should_close_for_good_when_a_newer_link_replaces_it_even_once_expired', () => {
    const replaced = issue('reset').closedAt('2026-10-24 12:00:00');

    expect(replaced.usedAt).toBe('2026-10-24 12:00:00');
    expect(replaced.isOpen('2026-10-24 10:30:00')).toBe(false);
    // a link already used keeps the moment it was used
    const used = issue('reset').use('2026-10-24 10:05:00');
    expect(used.closedAt('2026-10-24 12:00:00').usedAt).toBe('2026-10-24 10:05:00');
  });
});

