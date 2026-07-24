import { describe, expect, it } from 'vitest';
import { InvalidTorrentStateError, TorrentState } from '../../../../src/domain/torrent/TorrentState.js';

describe('TorrentState', () => {
  it('should_parse_the_closed_set_of_states', () => {
    expect(TorrentState.parse('loaded')).toBe(TorrentState.loaded);
    expect(TorrentState.parse('completed')).toBe(TorrentState.completed);
    expect(TorrentState.parse('rejected')).toBe(TorrentState.rejected);
  });

  it('should_reject_unknown_states', () => {
    for (const raw of ['', 'erased', 'LOADED', 'downloading']) {
      expect(() => TorrentState.parse(raw)).toThrow(InvalidTorrentStateError);
    }
  });

  it('should_expose_its_value_for_persistence', () => {
    expect(TorrentState.completed.value).toBe('completed');
  });
});
