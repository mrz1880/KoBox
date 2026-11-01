import { describe, expect, it } from 'vitest';
import { Blocklist } from '../../../../src/domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../../../src/domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../../../src/domain/tracker/BlocklistUrl.js';

function aList(overrides?: { subscription?: boolean; enabled?: boolean }) {
  return Blocklist.create({
    source: BlocklistSource.parse('iblocklist'),
    author: 'Example Org',
    name: 'level1',
    url: BlocklistUrl.parse('https://list.example.org/?list=abc&fileformat=p2p'),
    subscription: overrides?.subscription ?? false,
    enabled: overrides?.enabled ?? true,
  });
}

describe('Blocklist', () => {
  it('should_start_with_no_update_recorded', () => {
    expect(aList().lastUpdate).toBeUndefined();
    expect(aList().sha256).toBeUndefined();
  });

  it('should_record_a_successful_update_with_its_content_hash', () => {
    const updated = aList().recordSuccess('2026-07-24 10:00:00', 'abc123');
    expect(updated.lastUpdate).toEqual({ status: 'ok', at: '2026-07-24 10:00:00' });
    expect(updated.sha256).toBe('abc123');
  });

  it('should_record_a_failure_and_keep_the_previous_hash', () => {
    // issue #117: a failed refresh keeps the last good data around
    const failed = aList()
      .recordSuccess('2026-07-24 10:00:00', 'abc123')
      .recordFailure('2026-07-24 16:00:00');
    expect(failed.lastUpdate).toEqual({ status: 'failed', since: '2026-07-24 16:00:00', reported: false });
    expect(failed.sha256).toBe('abc123');
  });

  // a source that stays down is told apart from one that hiccupped once by how
  // long it has been failing, so the first failure is the one that counts
  it('should_remember_when_a_list_started_failing', () => {
    const failing = aList().recordFailure('2026-10-31 23:00:00').recordFailure('2026-11-01 05:00:00');

    expect(failing.lastUpdate).toEqual({ status: 'failed', since: '2026-10-31 23:00:00', reported: false });
  });

  // the old ranges stay in force while a list fails, so a night without an
  // update is nobody's problem; a full day of it is: an expired subscription,
  // a list that was withdrawn
  it.each([
    ['2026-11-01 05:00:00', false],
    ['2026-11-01 22:59:59', false],
    ['2026-11-01 23:00:00', true],
  ])('should_call_for_an_admin_only_after_a_day_of_failures_at_%s', (now, overdue) => {
    expect(aList().recordFailure('2026-10-31 23:00:00').overdueAt(now)).toBe(overdue);
  });

  it('should_call_for_an_admin_once_per_outage', () => {
    const reported = aList().recordFailure('2026-10-31 23:00:00').markReported();

    expect(reported.recordFailure('2026-11-02 05:00:00').overdueAt('2026-11-02 05:00:00')).toBe(false);
    expect(
      reported.recordSuccess('2026-11-02 11:00:00', 'abc').recordFailure('2026-11-03 11:00:00').overdueAt('2026-11-04 11:00:00'),
    ).toBe(true);
  });

  it('should_never_call_for_an_admin_while_the_list_updates', () => {
    expect(aList().recordSuccess('2026-07-24 10:00:00', 'abc').overdueAt('2026-08-24 10:00:00')).toBe(false);
  });

  it('should_toggle_enabled_immutably', () => {
    const disabled = aList().disable();
    expect(disabled.enabled).toBe(false);
    expect(disabled.enable().enabled).toBe(true);
  });

  it('should_expose_the_legacy_file_stem', () => {
    expect(aList().fileStem).toBe('Example_Org#level1');
  });

  it('should_reject_an_empty_name', () => {
    expect(() =>
      Blocklist.create({
        source: BlocklistSource.parse('personal'),
        author: 'me',
        name: '',
        url: BlocklistUrl.parse('https://list.example.org/x'),
        subscription: false,
        enabled: true,
      }),
    ).toThrow();
  });
});
