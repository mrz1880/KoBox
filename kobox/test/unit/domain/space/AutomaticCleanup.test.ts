import { describe, expect, it } from 'vitest';
import {
  InvalidAutomaticCleanupError,
  candidatesAllowedBy,
  parseAutomaticCleanup,
  type AutomaticCleanup,
} from '../../../../src/domain/space/AutomaticCleanup.js';
import { CleanupCandidate, type CleanupReason } from '../../../../src/domain/space/CleanupCandidate.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { Quota } from '../../../../src/domain/user/Quota.js';

function candidate(hashChar: string, reason: CleanupReason): CleanupCandidate {
  return CleanupCandidate.restore({
    infoHash: InfoHash.parse(hashChar.repeat(40)),
    name: `Example ${hashChar}`,
    size: Quota.gib(1),
    ratio: 2,
    finishedAt: '2026-10-01T08:00:00.000Z',
    path: `/home/alice/rtorrent/complete/Example ${hashChar}`,
    reason,
  });
}

const SENT = candidate('A', 'alreadySent');
const SEEDED = candidate('B', 'seeded');

describe('AutomaticCleanup', () => {
  it.each(['off', 'sentOnly', 'sentOrSeeded'] as const)('should_read_the_choice_%s', (raw) => {
    expect(parseAutomaticCleanup(raw)).toBe(raw);
  });

  it('should_refuse_a_choice_the_account_page_does_not_offer', () => {
    expect(() => parseAutomaticCleanup('everything')).toThrow(InvalidAutomaticCleanupError);
  });

  it.each<[AutomaticCleanup, readonly CleanupCandidate[]]>([
    ['off', []],
    // a seeded torrent may never have been fetched: only a sent one is safe
    ['sentOnly', [SENT]],
    ['sentOrSeeded', [SENT, SEEDED]],
  ])('should_let_the_choice_%s_delete_only_what_it_covers', (scope, allowed) => {
    expect(candidatesAllowedBy(scope, [SENT, SEEDED])).toEqual(allowed);
  });
});
