import { describe, expect, it } from 'vitest';
import {
  BlocklistSource,
  InvalidBlocklistSourceError,
} from '../../../../src/domain/tracker/BlocklistSource.js';

describe('BlocklistSource', () => {
  it('should_parse_iblocklist_and_personal', () => {
    expect(BlocklistSource.parse('iblocklist').value).toBe('iblocklist');
    expect(BlocklistSource.parse('personal').value).toBe('personal');
  });

  it('should_reject_anything_else', () => {
    for (const raw of ['subscription', 'IBLOCKLIST', '']) {
      expect(() => BlocklistSource.parse(raw)).toThrow(InvalidBlocklistSourceError);
    }
  });
});
