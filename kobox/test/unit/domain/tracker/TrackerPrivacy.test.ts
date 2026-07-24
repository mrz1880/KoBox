import { describe, expect, it } from 'vitest';
import {
  InvalidTrackerPrivacyError,
  TrackerPrivacy,
} from '../../../../src/domain/tracker/TrackerPrivacy.js';

describe('TrackerPrivacy', () => {
  it('should_parse_public_and_private', () => {
    expect(TrackerPrivacy.parse('public').value).toBe('public');
    expect(TrackerPrivacy.parse('private').value).toBe('private');
  });

  it('should_reject_anything_else', () => {
    for (const raw of ['Public', 'PRIVATE', 'open', '']) {
      expect(() => TrackerPrivacy.parse(raw)).toThrow(InvalidTrackerPrivacyError);
    }
  });
});
