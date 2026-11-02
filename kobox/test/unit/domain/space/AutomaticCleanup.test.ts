import { describe, expect, it } from 'vitest';
import {
  InvalidAutomaticCleanupError,
  parseAutomaticCleanup,
} from '../../../../src/domain/space/AutomaticCleanup.js';

describe('AutomaticCleanup', () => {
  it.each(['off', 'sentOnly', 'sentOrSeeded'] as const)('should_read_the_choice_%s', (raw) => {
    expect(parseAutomaticCleanup(raw)).toBe(raw);
  });

  it('should_refuse_a_choice_the_account_page_does_not_offer', () => {
    expect(() => parseAutomaticCleanup('everything')).toThrow(InvalidAutomaticCleanupError);
  });
});
