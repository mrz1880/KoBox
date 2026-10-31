// Kept apart from the SCHEDULED_JOBS tests on purpose: schedule.ts parses its
// table at import, so a broken parser would crash this whole file at load time
// instead of failing the assertions below.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CronSchedule,
  InvalidCronScheduleError,
} from '../../../../src/domain/maintenance/CronSchedule.js';

describe('CronSchedule', () => {
  it('should_parse_the_restricted_five_field_grammar', () => {
    for (const raw of ['*/5 * * * *', '0 * * * *', '0 */6 * * *', '10 0 * * *', '30 5 * * *']) {
      expect(CronSchedule.parse(raw).value).toBe(raw);
    }
  });

  it('should_reject_out_of_range_fields', () => {
    for (const raw of [
      '60 * * * *', // minute > 59
      '* 24 * * *', // hour > 23
      '* * 0 * *', // day-of-month < 1
      '* * 32 * *',
      '* * * 13 *', // month > 12
      '* * * * 8', // day-of-week > 7
      '*/0 * * * *', // zero step
    ]) {
      expect(() => CronSchedule.parse(raw)).toThrow(InvalidCronScheduleError);
    }
  });

  it('should_reject_anything_outside_the_restricted_grammar', () => {
    for (const raw of [
      '',
      '* * * *', // four fields
      '* * * * * *', // six fields
      '1-5 * * * *', // ranges not supported
      '1,2 * * * *', // lists not supported
      '@daily',
      'mon * * * *',
      '* * * * *; rm -rf /',
    ]) {
      expect(() => CronSchedule.parse(raw)).toThrow(InvalidCronScheduleError);
    }
  });

  it('should_never_accept_shell_metacharacters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /[^0-9*/ ]/.test(s)),
        (raw) => {
          expect(() => CronSchedule.parse(raw)).toThrow(InvalidCronScheduleError);
        },
      ),
    );
  });

  it('should_accept_every_field_at_both_ends_of_its_range', () => {
    for (const raw of ['0 0 1 1 0', '59 23 31 12 7', '*/1 */1 */1 */1 */1', '*/59 */23 */31 */12 */7']) {
      expect(CronSchedule.parse(raw).value).toBe(raw);
    }
  });

  it('should_reject_a_step_just_beyond_the_largest_value_of_its_field', () => {
    for (const [raw, step] of [
      ['*/60 * * * *', '*/60'],
      ['* */24 * * *', '*/24'],
      ['* * */32 * *', '*/32'],
      ['* * * */13 *', '*/13'],
      ['* * * * */8', '*/8'],
    ] as const) {
      expect(() => CronSchedule.parse(raw)).toThrow(`step ${step} out of range`);
    }
  });

  it('should_name_the_allowed_range_when_a_value_falls_outside_it', () => {
    expect(() => CronSchedule.parse('60 * * * *')).toThrow(
      'invalid cron schedule "60 * * * *": value 60 out of range [0-59]',
    );
    expect(() => CronSchedule.parse('* * 0 * *')).toThrow('value 0 out of range [1-31]');
    expect(() => CronSchedule.parse('* * * 0 *')).toThrow('value 0 out of range [1-12]');
  });

  it('should_say_what_the_grammar_allows_when_a_field_is_outside_it', () => {
    expect(() => CronSchedule.parse('1-5 * * * *')).toThrow(
      'field "1-5" is not *, */n or a number',
    );
    expect(() => CronSchedule.parse('* * * *')).toThrow('expected 5 space-separated fields');
  });

  it('should_reject_more_than_two_digits_even_when_the_number_is_in_range', () => {
    for (const raw of ['005 * * * *', '*/005 * * * *', '* 001 * * *']) {
      expect(() => CronSchedule.parse(raw)).toThrow(InvalidCronScheduleError);
    }
  });

  it('should_reject_a_number_or_step_with_anything_glued_before_or_after_it', () => {
    for (const raw of ['x5 * * * *', '5x * * * *', 'x*/5 * * * *', '*/5x * * * *', '** * * * *']) {
      expect(() => CronSchedule.parse(raw)).toThrow(InvalidCronScheduleError);
    }
  });

  it('should_render_as_the_text_it_was_parsed_from', () => {
    expect(String(CronSchedule.parse('10 0 * * *'))).toBe('10 0 * * *');
  });

  it('should_compare_by_value', () => {
    expect(CronSchedule.parse('*/5 * * * *').equals(CronSchedule.parse('*/5 * * * *'))).toBe(true);
    expect(CronSchedule.parse('*/5 * * * *').equals(CronSchedule.parse('0 * * * *'))).toBe(false);
  });

  // a member is told when their space is measured next: the schedule says
  // whether a given minute of the box's clock is one of its runs
  it.each([
    ['20 * * * *', { minute: 20, hour: 9, dayOfMonth: 31, month: 10, dayOfWeek: 6 }, true],
    ['20 * * * *', { minute: 21, hour: 9, dayOfMonth: 31, month: 10, dayOfWeek: 6 }, false],
    ['*/15 * * * *', { minute: 45, hour: 3, dayOfMonth: 1, month: 1, dayOfWeek: 0 }, true],
    ['*/15 * * * *', { minute: 50, hour: 3, dayOfMonth: 1, month: 1, dayOfWeek: 0 }, false],
    ['30 5 * * *', { minute: 30, hour: 5, dayOfMonth: 2, month: 3, dayOfWeek: 1 }, true],
    ['30 5 * * *', { minute: 30, hour: 6, dayOfMonth: 2, month: 3, dayOfWeek: 1 }, false],
    ['0 0 * * 7', { minute: 0, hour: 0, dayOfMonth: 2, month: 3, dayOfWeek: 0 }, true],
    ['0 0 1 * *', { minute: 0, hour: 0, dayOfMonth: 2, month: 3, dayOfWeek: 0 }, false],
    ['0 0 * 6 *', { minute: 0, hour: 0, dayOfMonth: 2, month: 3, dayOfWeek: 0 }, false],
    // a step counts from the field's first value: days start at 1, not 0
    ['0 0 */2 * *', { minute: 0, hour: 0, dayOfMonth: 1, month: 3, dayOfWeek: 0 }, true],
  ])('should_tell_whether_%s_runs_at_%o', (raw, time, runs) => {
    expect(CronSchedule.parse(raw).runsAt(time)).toBe(runs);
  });
});
