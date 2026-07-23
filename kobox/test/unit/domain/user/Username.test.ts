import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidUsernameError, Username } from '../../../../src/domain/user/Username.js';

const validUsernameArb = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
      maxLength: 31,
    }),
  )
  .map(([first, rest]) => `${first}${rest}`)
  .filter((name) => !Username.RESERVED.includes(name));

describe('Username', () => {
  it('should_accept_any_lowercase_alphanumeric_name_starting_with_letter', () => {
    fc.assert(
      fc.property(validUsernameArb, (raw) => {
        expect(Username.parse(raw).value).toBe(raw);
      }),
    );
  });

  it('should_reject_uppercase_and_symbols', () => {
    for (const raw of ['Tonyz', 'tony z', 'tony-z', 'tony_z', 'tony.z', 'éuser-a', '9tonyz', '']) {
      expect(() => Username.parse(raw)).toThrow(InvalidUsernameError);
    }
  });

  it('should_reject_shell_injection_attempts_by_construction', () => {
    for (const raw of ['a;rm -rf /', 'a$(reboot)', 'a|id', 'a&&id', 'a`id`', 'a\nid', "a'b"]) {
      expect(() => Username.parse(raw)).toThrow(InvalidUsernameError);
    }
  });

  it('should_reject_names_longer_than_32_chars', () => {
    expect(() => Username.parse('a'.repeat(33))).toThrow(InvalidUsernameError);
    expect(Username.parse('a'.repeat(32)).value).toBe('a'.repeat(32));
  });

  it('should_reject_reserved_names', () => {
    for (const raw of ['root', 'plex', 'ftp', 'admin', 'kobox', 'daemon', 'nobody', 'sshd']) {
      expect(() => Username.parse(raw)).toThrow(InvalidUsernameError);
    }
  });

  it('should_compare_by_value', () => {
    expect(Username.parse('user-f').equals(Username.parse('user-f'))).toBe(true);
    expect(Username.parse('user-f').equals(Username.parse('user-a'))).toBe(false);
  });
});
