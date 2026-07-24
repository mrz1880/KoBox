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
    const failed = aList().recordSuccess('2026-07-24 10:00:00', 'abc123').recordFailure();
    expect(failed.lastUpdate).toEqual({ status: 'failed' });
    expect(failed.sha256).toBe('abc123');
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
