import { describe, expect, it } from 'vitest';
import { CleanupCandidate } from '../../../../src/domain/space/CleanupCandidate.js';
import { CleanupProposal } from '../../../../src/domain/space/CleanupProposal.js';
import { SeedRule } from '../../../../src/domain/space/SeedRule.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { Quota } from '../../../../src/domain/user/Quota.js';

const candidate = (name: string, sizeGib: number, ratio = 2): CleanupCandidate => {
  const judged = CleanupCandidate.judge(
    {
      infoHash: InfoHash.parse(name.charAt(0).repeat(40)),
      name,
      size: Quota.gib(sizeGib),
      ratio,
      finishedAt: '2026-10-01T12:00:00.000Z',
      path: `/home/alice/rtorrent/complete/${name}`,
    },
    { rule: SeedRule.DEFAULT, sentPaths: new Set(), now: '2026-11-02T12:00:00.000Z' },
  );
  if (judged === undefined) {
    throw new Error(`fixture ${name} should qualify for cleanup`);
  }
  return judged;
};

const namesOf = (proposal: CleanupProposal): string[] =>
  proposal.lines.map((line) => line.candidate.name);

describe('CleanupProposal', () => {
  it('should_propose_nothing_and_free_nothing_without_candidates', () => {
    const proposal = CleanupProposal.of({
      candidates: [],
      used: Quota.gib(95),
      allowance: Quota.gib(100),
    });

    expect(proposal.lines).toEqual([]);
    expect(proposal.freed().toBytes()).toBe(0);
  });

  it('should_propose_the_largest_first_and_the_most_seeded_first_among_equal_sizes', () => {
    const proposal = CleanupProposal.of({
      candidates: [candidate('a', 10, 2), candidate('b', 20, 3), candidate('c', 10, 5)],
      used: Quota.gib(95),
      allowance: Quota.gib(100),
    });

    expect(namesOf(proposal)).toEqual(['b', 'c', 'a']);
  });

  // 95 of 100 GiB: 10, 4 then 3 GiB bring the member to 78, under the 80 % line
  it('should_check_lines_until_the_member_is_back_at_the_filling_line', () => {
    const proposal = CleanupProposal.of({
      candidates: [candidate('a', 10), candidate('b', 4), candidate('c', 3), candidate('d', 2)],
      used: Quota.gib(95),
      allowance: Quota.gib(100),
    });

    expect(proposal.lines.map((line) => line.checked)).toEqual([true, true, true, false]);
  });

  it('should_free_what_the_checked_lines_take', () => {
    const proposal = CleanupProposal.of({
      candidates: [candidate('a', 10), candidate('b', 4), candidate('c', 3), candidate('d', 2)],
      used: Quota.gib(95),
      allowance: Quota.gib(100),
    });

    expect(proposal.freed().toGib()).toBe(17);
  });

  // the member unchecked a line and checked another one past the line
  it('should_free_what_the_member_selected_instead_once_they_chose', () => {
    const proposal = CleanupProposal.of({
      candidates: [candidate('a', 10), candidate('b', 4), candidate('c', 3), candidate('d', 2)],
      used: Quota.gib(95),
      allowance: Quota.gib(100),
    });

    const selection = [InfoHash.parse('b'.repeat(40)), InfoHash.parse('d'.repeat(40))];

    expect(proposal.freed(selection).toGib()).toBe(6);
  });
});
