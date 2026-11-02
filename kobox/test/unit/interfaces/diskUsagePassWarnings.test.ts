import { describe, expect, it } from 'vitest';
import { Username } from '../../../src/domain/user/Username.js';
import {
  diskUsagePassWarnings,
  warningLine,
} from '../../../src/interfaces/diskUsagePassWarnings.js';

const alice = Username.parse('alice');

// a pass that did everything it set out to
const NOTHING_SKIPPED = {
  volumeError: undefined,
  unmeasured: [],
  staleSnapshots: [],
  unwatched: [],
} as const;

describe('what an hourly pass could not do, said to the operator', () => {
  // run by hand, the pass prints it rather than leaving the operator guessing
  it('should_say_one_line_per_member_whose_cleanup_list_was_not_refreshed', () => {
    const lines = diskUsagePassWarnings({
      ...NOTHING_SKIPPED,
      staleSnapshots: [
        { username: alice, cause: 'rtorrentSilent', error: 'rtorrent SCGI on 51101 does not answer' },
      ],
    }).map(warningLine);

    expect(lines).toEqual([
      'space cleanup: list not refreshed username="alice" cause="rtorrentSilent" error="rtorrent SCGI on 51101 does not answer"',
    ]);
  });

  // skipped, their usage and the volume's stop moving on the pages
  it('should_say_the_volume_and_each_member_the_pass_could_not_measure', () => {
    const lines = diskUsagePassWarnings({
      ...NOTHING_SKIPPED,
      volumeError: 'statfs: no such file or directory',
      unmeasured: [{ username: alice, error: 'quota: cannot read /home' }],
    }).map(warningLine);

    expect(lines).toEqual([
      'disk usage: volume not measured error="statfs: no such file or directory"',
      'disk usage: member not measured username="alice" error="quota: cannot read /home"',
    ]);
  });
});
