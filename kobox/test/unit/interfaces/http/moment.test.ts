import { describe, expect, it } from 'vitest';
import { CronSchedule } from '../../../../src/domain/maintenance/CronSchedule.js';
import {
  formatAgo,
  formatClock,
  formatMoment,
  nextRunAfter,
} from '../../../../src/interfaces/http/views/moment.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';

const french = { language: Language.fr, t: translatorFor(Language.fr), zone: 'Europe/Paris' };

// stamps are written in UTC; a reader expects the box's own clock
describe('formatMoment', () => {
  it('should_say_a_utc_stamp_in_the_box_time_zone_and_the_readers_words', () => {
    expect(formatMoment('2026-10-30 19:37:28', french)).toBe('30 octobre 2026 à 20:37');
  });
});

describe('formatAgo', () => {
  it.each([
    ['2026-10-31 08:20:00', '2026-10-31 08:32:30', 'il y a 12 minutes'],
    ['2026-10-31 05:20:00', '2026-10-31 08:32:30', 'il y a 3 heures'],
    ['2026-10-29 08:20:00', '2026-10-31 08:32:30', 'il y a 2 jours'],
    ['2026-10-31 08:32:10', '2026-10-31 08:32:30', 'à l’instant'],
  ])('should_say_%s_seen_at_%s_as_%s', (stamp, now, said) => {
    expect(formatAgo(stamp, now, french)).toBe(said);
  });
});

// the worker's cron runs on the box's clock, so the next run is found there
describe('nextRunAfter', () => {
  it('should_find_the_next_minute_the_schedule_runs_at_on_the_box_clock', () => {
    const next = nextRunAfter(CronSchedule.parse('20 * * * *'), '2026-10-31 08:32:30', french);

    expect(next).toBe('2026-10-31 09:20:00');
    expect(formatClock(next ?? '', french)).toBe('10:20');
  });

  // an hour field is read on the box's clock, not in UTC
  it('should_read_an_hour_field_on_the_box_clock', () => {
    expect(nextRunAfter(CronSchedule.parse('30 5 * * *'), '2026-10-31 08:32:30', french)).toBe(
      '2026-11-01 04:30:00',
    );
  });
});
