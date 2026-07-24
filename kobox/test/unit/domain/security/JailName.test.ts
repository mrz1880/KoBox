import { describe, expect, it } from 'vitest';
import { InvalidJailNameError, JailName } from '../../../../src/domain/security/JailName.js';

describe('JailName', () => {
  it('should_accept_lowercase_names_with_digits_and_dashes', () => {
    expect(JailName.parse('sshd').value).toBe('sshd');
    expect(JailName.parse('nginx-http-auth').value).toBe('nginx-http-auth');
    expect(JailName.parse('kobox-publickey-flood').value).toBe('kobox-publickey-flood');
  });

  it('should_reject_uppercase_leading_digits_and_metacharacters', () => {
    for (const raw of ['Sshd', '1jail', 'jail name', 'jail;id', 'jail_x', '', '-jail']) {
      expect(() => JailName.parse(raw)).toThrow(InvalidJailNameError);
    }
  });

  it('should_reject_names_longer_than_32_chars', () => {
    expect(() => JailName.parse(`a${'b'.repeat(32)}`)).toThrow(InvalidJailNameError);
    expect(JailName.parse(`a${'b'.repeat(31)}`).value).toHaveLength(32);
  });

  it('should_compare_by_value', () => {
    expect(JailName.parse('sshd').equals(JailName.parse('sshd'))).toBe(true);
    expect(JailName.parse('sshd').equals(JailName.parse('vsftpd'))).toBe(false);
  });
});
