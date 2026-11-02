import { describe, expect, it } from 'vitest';
import { CleanupCandidate } from '../../../../src/domain/space/CleanupCandidate.js';
import type { FinishedTorrent } from '../../../../src/domain/space/FinishedTorrent.js';
import { SeedRule } from '../../../../src/domain/space/SeedRule.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { Quota } from '../../../../src/domain/user/Quota.js';

const now = '2026-11-20T12:00:00.000Z';
const rule = SeedRule.of({ ratio: 2, days: 7 });
const path = '/home/alice/rtorrent/complete/Example.Release';

const torrent = (overrides: Partial<FinishedTorrent> = {}): FinishedTorrent => ({
  infoHash: InfoHash.parse('A'.repeat(40)),
  name: 'Example.Release',
  size: Quota.gib(12),
  ratio: 0.4,
  finishedAt: '2026-11-18T12:00:00.000Z',
  path,
  ...overrides,
});

describe('CleanupCandidate', () => {
  it('should_propose_a_torrent_that_seeded_enough_as_seeded', () => {
    const candidate = CleanupCandidate.judge(
      torrent({ ratio: 2.4, finishedAt: '2026-11-08T12:00:00.000Z' }),
      { rule, sentPaths: new Set(), now },
    );

    expect(candidate?.reason).toBe('seeded');
    expect(candidate?.size.toGib()).toBe(12);
  });

  it('should_keep_a_torrent_neither_seeded_enough_nor_sent', () => {
    expect(CleanupCandidate.judge(torrent(), { rule, sentPaths: new Set(), now })).toBeUndefined();
  });

  it('should_propose_a_torrent_sync_already_sent_as_already_sent', () => {
    const candidate = CleanupCandidate.judge(torrent(), { rule, sentPaths: new Set([path]), now });

    expect(candidate?.reason).toBe('alreadySent');
  });

  // a copy on the member's own machine reassures more than a ratio does
  it('should_name_the_sending_when_a_torrent_was_also_seeded_enough', () => {
    const candidate = CleanupCandidate.judge(
      torrent({ ratio: 2.4, finishedAt: '2026-11-08T12:00:00.000Z' }),
      { rule, sentPaths: new Set([path]), now },
    );

    expect(candidate?.reason).toBe('alreadySent');
  });

  it('should_keep_a_torrent_still_downloading_even_once_sent', () => {
    const candidate = CleanupCandidate.judge(torrent({ ratio: 3, finishedAt: undefined }), {
      rule,
      sentPaths: new Set([path]),
      now,
    });

    expect(candidate).toBeUndefined();
  });

  // a snapshot read back from storage keeps the reason it was judged with,
  // even though the rule or the transfers may have moved on since
  it('should_restore_a_candidate_as_it_was_judged', () => {
    const candidate = CleanupCandidate.restore({
      infoHash: InfoHash.parse('B'.repeat(40)),
      name: 'Example.Album',
      size: Quota.bytes(2048),
      ratio: 0.5,
      finishedAt: '2026-11-18T12:00:00.000Z',
      path,
      reason: 'alreadySent',
    });

    expect(candidate).toMatchObject({
      name: 'Example.Album',
      ratio: 0.5,
      finishedAt: '2026-11-18T12:00:00.000Z',
      path,
      reason: 'alreadySent',
    });
    expect(candidate.infoHash.value).toBe('B'.repeat(40));
    expect(candidate.size.toBytes()).toBe(2048);
  });
});
