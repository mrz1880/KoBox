import { describe, expect, it } from 'vitest';
import { AccountType, InvalidAccountTypeError } from '../../../../src/domain/user/AccountType.js';

describe('AccountType', () => {
  it('should_parse_the_closed_set_normal_plex', () => {
    expect(AccountType.parse('normal')).toBe(AccountType.normal);
    expect(AccountType.parse('plex')).toBe(AccountType.plex);
  });

  it('should_reject_unknown_types', () => {
    expect(() => AccountType.parse('admin')).toThrow(InvalidAccountTypeError);
    expect(() => AccountType.parse('')).toThrow(InvalidAccountTypeError);
  });

  it('should_expose_its_value', () => {
    expect(AccountType.normal.value).toBe('normal');
    expect(AccountType.plex.value).toBe('plex');
  });
});
