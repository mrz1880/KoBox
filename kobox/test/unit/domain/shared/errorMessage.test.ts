import { describe, expect, it } from 'vitest';
import { messageOf } from '../../../../src/domain/shared/errorMessage.js';

describe('messageOf', () => {
  it('should_give_the_message_of_an_error', () => {
    expect(messageOf(new RangeError('out of range'))).toBe('out of range');
  });

  it('should_spell_out_anything_else_that_was_thrown', () => {
    expect(messageOf('disk full')).toBe('disk full');
    expect(messageOf(42)).toBe('42');
  });
});
