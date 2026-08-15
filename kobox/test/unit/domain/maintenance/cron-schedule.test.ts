import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CronSchedule,
  InvalidCronScheduleError,
} from '../../../../src/domain/maintenance/CronSchedule.js';
import { SCHEDULED_JOBS } from '../../../../src/domain/maintenance/schedule.js';

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

  it('should_compare_by_value', () => {
    expect(CronSchedule.parse('*/5 * * * *').equals(CronSchedule.parse('*/5 * * * *'))).toBe(true);
    expect(CronSchedule.parse('*/5 * * * *').equals(CronSchedule.parse('0 * * * *'))).toBe(false);
  });
});

describe('SCHEDULED_JOBS', () => {
  it('should_cover_the_legacy_cron_parity_table', () => {
    // PROD-INSPECTION §2 → AUDIT §1.7: each surviving legacy entry maps to a
    // typed-job CLI command; watchdog/self-update entries die by design.
    const bySubcommand = new Map(SCHEDULED_JOBS.map((entry) => [entry.command, entry]));
    expect(bySubcommand.get('resolve-dyndns')?.schedule.value).toBe('*/5 * * * *');
    expect(bySubcommand.get('send-mails')?.schedule.value).toBe('*/5 * * * *');
    expect(bySubcommand.get('evaluate-fair-use')?.schedule.value).toBe('*/5 * * * *');
    expect(bySubcommand.get('update-blocklists')?.schedule.value).toBe('0 */6 * * *');
    expect(bySubcommand.get('renew-tracker-certs')?.schedule.value).toBe('10 0 * * *');
    expect(bySubcommand.get('run-backup')?.schedule.value).toBe('30 5 * * *');
    expect(bySubcommand.get('poll-debrid-downloads')?.schedule.value).toBe('*/2 * * * *');
    // the update CHECK is scheduled; applying them never is
    expect(bySubcommand.get('check-package-updates')?.schedule.value).toBe('40 5 * * *');
    expect(bySubcommand.has('apply-package-updates')).toBe(false);
    // hourly: the pass itself decides whose hour it is
    expect(bySubcommand.get('send-pending-transfers')?.schedule.value).toBe('5 * * * *');
    expect(SCHEDULED_JOBS).toHaveLength(10);
  });

  it('should_only_reference_shell_safe_kobox_subcommands', () => {
    for (const entry of SCHEDULED_JOBS) {
      expect(entry.command).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
