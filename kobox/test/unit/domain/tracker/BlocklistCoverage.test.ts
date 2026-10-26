import { describe, expect, it } from 'vitest';
import { Blocklist } from '../../../../src/domain/tracker/Blocklist.js';
import { blocklistCoverage } from '../../../../src/domain/tracker/BlocklistCoverage.js';
import { BlocklistSource } from '../../../../src/domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../../../src/domain/tracker/BlocklistUrl.js';

function aList(name: string, enabled: boolean): Blocklist {
  return Blocklist.create({
    source: BlocklistSource.parse('iblocklist'),
    author: 'Example Org',
    name,
    url: BlocklistUrl.parse(`https://list.example.org/?list=${name}&fileformat=p2p`),
    subscription: false,
    enabled,
  });
}

// a fresh box blocked nothing until somebody thought of importing the catalog:
// the overview has to say so, and say which of the two steps is missing
describe('blocklistCoverage', () => {
  it('should_tell_apart_no_list_lists_never_downloaded_and_active_lists', () => {
    const downloaded = aList('level1', true).recordSuccess('2026-10-26 09:41:00', 'aa');

    expect(blocklistCoverage([])).toBe('no-list-enabled');
    expect(blocklistCoverage([aList('level1', false)])).toBe('no-list-enabled');
    expect(blocklistCoverage([aList('level1', true)])).toBe('not-downloaded-yet');
    expect(blocklistCoverage([aList('level2', true).recordFailure()])).toBe('not-downloaded-yet');
    expect(blocklistCoverage([aList('level2', true), downloaded])).toBe('blocking');
  });
});
