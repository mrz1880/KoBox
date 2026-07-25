import { describe, expect, it } from 'vitest';
import {
  MAX_MAIL_ATTEMPTS,
  nextAttemptDelayMinutes,
} from '../../../../src/domain/maintenance/outbox.js';

describe('outbox retry policy', () => {
  it('should_back_off_5m_30m_2h_12h_between_attempts', () => {
    // delay applied AFTER the nth failed attempt (1-based)
    expect(nextAttemptDelayMinutes(1)).toBe(5);
    expect(nextAttemptDelayMinutes(2)).toBe(30);
    expect(nextAttemptDelayMinutes(3)).toBe(120);
    expect(nextAttemptDelayMinutes(4)).toBe(720);
  });

  it('should_declare_the_mail_dead_after_the_fifth_attempt', () => {
    expect(MAX_MAIL_ATTEMPTS).toBe(5);
    expect(nextAttemptDelayMinutes(5)).toBeUndefined();
    expect(nextAttemptDelayMinutes(6)).toBeUndefined();
  });

  it('should_reject_a_nonpositive_attempt_count', () => {
    expect(() => nextAttemptDelayMinutes(0)).toThrow();
    expect(() => nextAttemptDelayMinutes(-1)).toThrow();
  });
});
