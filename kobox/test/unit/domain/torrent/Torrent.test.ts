import { describe, expect, it } from 'vitest';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { InvalidTorrentNameError, Torrent } from '../../../../src/domain/torrent/Torrent.js';
import { TorrentState } from '../../../../src/domain/torrent/TorrentState.js';

const HASH = InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0');

describe('Torrent', () => {
  it('should_load_with_an_optional_label', () => {
    const torrent = Torrent.load({ infoHash: HASH, name: 'debian-12.iso', label: Label.parse('films') });
    expect(torrent.state).toBe(TorrentState.loaded);
    expect(torrent.label?.value).toBe('films');
    expect(torrent.tree).toBeUndefined();
  });

  it('should_reject_an_empty_name', () => {
    expect(() => Torrent.load({ infoHash: HASH, name: '  ' })).toThrow(InvalidTorrentNameError);
  });

  it('should_transition_to_completed_with_its_tree', () => {
    const completed = Torrent.load({ infoHash: HASH, name: 'x' }).complete('/home/alice/rtorrent/complete/x');
    expect(completed.state).toBe(TorrentState.completed);
    expect(completed.tree).toBe('/home/alice/rtorrent/complete/x');
  });

  it('should_transition_to_rejected', () => {
    expect(Torrent.load({ infoHash: HASH, name: 'x' }).reject().state).toBe(TorrentState.rejected);
  });
});
