import { describe, expect, it } from 'vitest';
import { CheckState, InvalidCheckStateError } from '../../../../src/domain/tracker/CheckState.js';

describe('CheckState', () => {
  it('should_parse_the_closed_set_of_states', () => {
    expect(CheckState.parse('none').value).toBe('none');
    expect(CheckState.parse('pending').value).toBe('pending');
    expect(CheckState.parse('checking').value).toBe('checking');
  });

  it('should_reject_anything_else', () => {
    for (const raw of ['done', '1', '', 'NONE']) {
      expect(() => CheckState.parse(raw)).toThrow(InvalidCheckStateError);
    }
  });

  it('should_map_the_legacy_to_check_values', () => {
    expect(CheckState.fromLegacy(0).value).toBe('none');
    expect(CheckState.fromLegacy(1).value).toBe('pending');
    expect(CheckState.fromLegacy(3).value).toBe('checking');
    expect(() => CheckState.fromLegacy(2)).toThrow(InvalidCheckStateError);
  });
});
