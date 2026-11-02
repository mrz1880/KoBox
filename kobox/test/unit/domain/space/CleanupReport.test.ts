import { describe, expect, it } from 'vitest';
import { CleanupReport } from '../../../../src/domain/space/CleanupReport.js';
import { Quota } from '../../../../src/domain/user/Quota.js';

describe('CleanupReport', () => {
  it('should_count_as_freed_only_what_was_deleted', () => {
    const report = CleanupReport.of({
      deleted: [
        { name: 'Example Film', size: Quota.gib(12) },
        { name: 'Example Album', size: Quota.gib(1) },
      ],
      skipped: [{ name: 'Example Show', reason: 'noLongerQualifies' }],
      at: '2026-11-20 12:00:00',
    });

    expect(report.freed.toGib()).toBe(13);
  });

  // what the member's choice no longer applied to is not a failure; what the
  // box could not remove is, and someone has to look at it
  it('should_tell_apart_the_torrents_the_box_failed_to_remove', () => {
    const report = CleanupReport.of({
      deleted: [],
      skipped: [
        { name: 'Example Show', reason: 'noLongerQualifies' },
        { name: 'Example Film', reason: 'notErased' },
        { name: 'C'.repeat(40), reason: 'gone' },
        { name: 'Example Album', reason: 'dataKept' },
      ],
      at: '2026-11-20 12:00:00',
    });

    expect(report.failures).toEqual([
      { name: 'Example Film', reason: 'notErased' },
      { name: 'Example Album', reason: 'dataKept' },
    ]);
  });
});
