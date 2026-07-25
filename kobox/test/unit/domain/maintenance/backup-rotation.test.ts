import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  backupStamp,
  planBackupRotation,
} from '../../../../src/domain/maintenance/backup.js';

const NOW = '2026-07-25 10:00:00';

describe('backupStamp', () => {
  it('should_render_a_sortable_filesystem_safe_stamp', () => {
    expect(backupStamp(NOW)).toBe('20260725T100000Z');
  });
});

describe('planBackupRotation', () => {
  const opts = { ttlDays: 7, keepMin: 3 };

  it('should_delete_backups_older_than_the_ttl_beyond_the_newest_keep_min', () => {
    const stamps = [
      '20260701T053000Z', // 24 days old
      '20260710T053000Z', // 15 days old
      '20260720T053000Z', // 5 days old
      '20260724T053000Z',
      '20260725T053000Z',
    ];
    expect(planBackupRotation(stamps, NOW, opts)).toEqual(['20260701T053000Z', '20260710T053000Z']);
  });

  it('should_keep_expired_backups_when_they_are_all_we_have', () => {
    // a box that was off for a month must not delete its whole history
    const stamps = ['20260601T053000Z', '20260602T053000Z', '20260603T053000Z'];
    expect(planBackupRotation(stamps, NOW, opts)).toEqual([]);
  });

  it('should_keep_the_newest_keep_min_even_if_expired', () => {
    const stamps = ['20260601T053000Z', '20260602T053000Z', '20260603T053000Z', '20260604T053000Z'];
    expect(planBackupRotation(stamps, NOW, opts)).toEqual(['20260601T053000Z']);
  });

  it('should_never_delete_anything_younger_than_the_ttl', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 20 }),
        (agesDays) => {
          const stamps = agesDays.map((age, i) => {
            const date = new Date(`2026-07-25T10:00:00Z`);
            date.setUTCDate(date.getUTCDate() - age);
            date.setUTCSeconds(i); // unique stamps
            return `${date.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', 'T')}Z`;
          });
          const deleted = planBackupRotation(stamps, NOW, opts);
          const survivors = stamps.filter((s) => !deleted.includes(s));
          // invariant 1: at least keepMin survive (or everything, if fewer)
          expect(survivors.length).toBeGreaterThanOrEqual(Math.min(stamps.length, opts.keepMin));
          // invariant 2: nothing younger than the TTL dies
          for (const stamp of deleted) {
            const age = Date.parse(`${NOW.replace(' ', 'T')}Z`) - parseStamp(stamp);
            expect(age).toBeGreaterThan(opts.ttlDays * 86_400_000);
          }
        },
      ),
    );
  });
});

function parseStamp(stamp: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) throw new Error(`bad stamp ${stamp}`);
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}
