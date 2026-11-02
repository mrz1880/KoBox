import { describe, expect, it } from 'vitest';
import { Username } from '../../../src/domain/user/Username.js';
import {
  diskUsagePassWarnings,
  warningLine,
} from '../../../src/interfaces/diskUsagePassWarnings.js';

const alice = Username.parse('alice');

describe('what an hourly pass could not do, said to the operator', () => {
  // run by hand, the pass prints it rather than leaving the operator guessing
  it('should_say_one_line_per_member_whose_cleanup_list_was_not_refreshed', () => {
    const lines = diskUsagePassWarnings({
      staleSnapshots: [
        { username: alice, cause: 'rtorrentSilent', error: 'rtorrent SCGI on 51101 does not answer' },
      ],
      unwatched: [],
    }).map(warningLine);

    expect(lines).toEqual([
      'space cleanup: list not refreshed username="alice" cause="rtorrentSilent" error="rtorrent SCGI on 51101 does not answer"',
    ]);
  });
});
