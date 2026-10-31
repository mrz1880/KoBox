import { describe, expect, it } from 'vitest';
import { formatMoment } from '../../../../src/interfaces/http/views/moment.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';

const french = { language: Language.fr, t: translatorFor(Language.fr), zone: 'Europe/Paris' };

// stamps are written in UTC; a reader expects the box's own clock
describe('formatMoment', () => {
  it('should_say_a_utc_stamp_in_the_box_time_zone_and_the_readers_words', () => {
    expect(formatMoment('2026-10-30 19:37:28', french)).toBe('30 octobre 2026 à 20:37');
  });
});
