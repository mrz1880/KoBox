import { describe, expect, it } from 'vitest';
import {
  InvalidRemotePasswordError,
  RemotePassword,
} from '../../../../src/domain/sync/RemotePassword.js';

describe('RemotePassword', () => {
  it('should_accept_one_character_and_exactly_256', () => {
    expect(RemotePassword.parse('x').reveal()).toBe('x');
    expect(RemotePassword.parse('x'.repeat(256)).reveal()).toBe('x'.repeat(256));
  });

  it('should_refuse_an_empty_password', () => {
    expect(() => RemotePassword.parse('')).toThrow('invalid remote password: it is empty');
  });

  it('should_refuse_a_password_of_257_characters', () => {
    expect(() => RemotePassword.parse('x'.repeat(257))).toThrow(
      'invalid remote password: longer than 256 characters',
    );
  });

  it('should_refuse_a_line_break_or_a_nul_since_sshpass_reads_one_line', () => {
    for (const raw of ['before\nafter', 'before\0after']) {
      expect(() => RemotePassword.parse(raw), JSON.stringify(raw)).toThrow(
        InvalidRemotePasswordError,
      );
      expect(() => RemotePassword.parse(raw), JSON.stringify(raw)).toThrow(
        'invalid remote password: it contains a line break',
      );
    }
  });

  it('should_stay_redacted_when_serialized', () => {
    expect(RemotePassword.parse('correct horse').toJSON()).toBe('[redacted]');
  });
});
