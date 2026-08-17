import { describe, expect, it } from 'vitest';
import { AppToken, InvalidAppTokenError } from '../../../../src/domain/portal/AppToken.js';

describe('AppToken', () => {
  it('should_never_reveal_itself_through_a_log_line_or_a_template', () => {
    const token = AppToken.parse('a'.repeat(64));

    expect(token.reveal()).toBe('a'.repeat(64));
    expect(String(token)).toBe('[redacted]');
    expect(JSON.stringify({ token })).not.toContain('aaa');
  });

  it('should_refuse_anything_a_generator_would_not_have_produced', () => {
    // it is machine-issued, never typed: a short or oddly shaped value means
    // something other than a KoBox token is being presented
    for (const bad of ['', 'short', 'a'.repeat(20), `${'a'.repeat(63)} `, 'A'.repeat(64), 'z'.repeat(64)]) {
      expect(() => AppToken.parse(bad), JSON.stringify(bad)).toThrow(InvalidAppTokenError);
    }
  });

  it('should_accept_what_the_generator_actually_emits', () => {
    expect(() => AppToken.parse('0123456789abcdef'.repeat(4))).not.toThrow();
  });
});
