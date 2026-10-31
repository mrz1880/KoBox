import { describe, expect, it } from 'vitest';
import type { ScheduledJob } from '../../../../src/domain/maintenance/schedule.js';

// The table is built (and every entry parsed and checked) when the module is
// first imported. Importing it inside the tests turns a table that no longer
// builds into a failing test rather than a file that never loads.
async function scheduledJobs(): Promise<readonly ScheduledJob[]> {
  return (await import('../../../../src/domain/maintenance/schedule.js')).SCHEDULED_JOBS;
}

describe('SCHEDULED_JOBS', () => {
  it('should_cover_the_legacy_cron_parity_table', async () => {
    // Legacy root cron: each surviving legacy entry maps to a
    // typed-job CLI command; watchdog/self-update entries die by design.
    const bySubcommand = new Map((await scheduledJobs()).map((entry) => [entry.command, entry]));
    expect(bySubcommand.get('resolve-dyndns')?.schedule.value).toBe('*/5 * * * *');
    expect(bySubcommand.get('send-mails')?.schedule.value).toBe('*/5 * * * *');
    expect(bySubcommand.get('evaluate-fair-use')?.schedule.value).toBe('*/5 * * * *');
    expect(bySubcommand.get('update-blocklists')?.schedule.value).toBe('0 */6 * * *');
    expect(bySubcommand.get('renew-tracker-certs')?.schedule.value).toBe('10 0 * * *');
    expect(bySubcommand.get('run-backup')?.schedule.value).toBe('30 5 * * *');
    // the update CHECK is scheduled; applying them never is
    expect(bySubcommand.get('check-package-updates')?.schedule.value).toBe('40 5 * * *');
    expect(bySubcommand.has('apply-package-updates')).toBe(false);
    // hourly: the pass itself decides whose hour it is
    expect(bySubcommand.get('send-pending-transfers')?.schedule.value).toBe('5 * * * *');
    // the portal is non-root and cannot read another account's quota, so this
    // one exists for KoBox itself rather than for legacy parity
    expect(bySubcommand.get('sample-disk-usage')?.schedule.value).toBe('20 * * * *');
    // files also come and go over SFTP, outside any KoBox event
    expect(bySubcommand.get('index-media')?.schedule.value).toBe('*/15 * * * *');
    expect(await scheduledJobs()).toHaveLength(10);
  });

  it('should_only_reference_shell_safe_kobox_subcommands', async () => {
    for (const entry of await scheduledJobs()) {
      expect(entry.command).toMatch(/^[a-z0-9-]+$/);
    }
  });

  // a page that says when something runs next reads it from this table
  it('should_find_the_schedule_of_a_subcommand_or_nothing', async () => {
    const { scheduleOf } = await import('../../../../src/domain/maintenance/schedule.js');

    expect(scheduleOf('sample-disk-usage')?.value).toBe('20 * * * *');
    expect(scheduleOf('no-such-job')).toBeUndefined();
  });
});
