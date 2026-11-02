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
});
