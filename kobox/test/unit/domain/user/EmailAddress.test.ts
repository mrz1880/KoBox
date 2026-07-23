import { describe, expect, it } from 'vitest';
import { EmailAddress, InvalidEmailAddressError } from '../../../../src/domain/user/EmailAddress.js';

describe('EmailAddress', () => {
  it('should_accept_common_addresses_and_normalize_to_lowercase', () => {
    expect(EmailAddress.parse('MrZ1880@Gmail.com').value).toBe('the-maintainer@gmail.com');
    expect(EmailAddress.parse('a.b+tag@sub.domain.org').value).toBe('a.b+tag@sub.domain.org');
  });

  it('should_reject_malformed_addresses', () => {
    for (const raw of ['', 'no-at-sign', '@nodomain', 'user@', 'a b@c.d', 'user@@x.y', 'user@x']) {
      expect(() => EmailAddress.parse(raw)).toThrow(InvalidEmailAddressError);
    }
  });

  it('should_compare_by_value', () => {
    expect(EmailAddress.parse('x@y.fr').equals(EmailAddress.parse('X@Y.FR'))).toBe(true);
  });
});
