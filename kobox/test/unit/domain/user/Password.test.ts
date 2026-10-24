import { describe, expect, it } from 'vitest';
import { InvalidPasswordError, Password } from '../../../../src/domain/user/Password.js';

describe('Password', () => {
  it('should_accept_passwords_of_8_chars_or_more', () => {
    expect(Password.parse('s3cretpw').reveal()).toBe('s3cretpw');
  });

  it('should_reject_short_or_empty_passwords', () => {
    for (const raw of ['', 'short', '1234567']) {
      expect(() => Password.parse(raw)).toThrow(InvalidPasswordError);
    }
  });

  it('should_reject_a_password_longer_than_100_characters', () => {
    expect(Password.parse('a'.repeat(100)).reveal()).toHaveLength(100);
    expect(() => Password.parse('a'.repeat(101))).toThrow(InvalidPasswordError);
  });

  // Samba reads the new password and its confirmation as two lines on stdin:
  // a line break inside one would split it into two different passwords
  it('should_reject_a_password_containing_a_line_break_or_a_nul', () => {
    for (const raw of ['before\nafter1', 'before\rafter1', 'before\0after1']) {
      expect(() => Password.parse(raw)).toThrow(InvalidPasswordError);
    }
  });

  it('should_never_leak_the_secret_through_string_conversion', () => {
    const password = Password.parse('s3cretpw');

    expect(String(password)).not.toContain('s3cretpw');
    expect(JSON.stringify({ password })).not.toContain('s3cretpw');
    expect(password.toString()).toBe('[redacted]');
  });
});
