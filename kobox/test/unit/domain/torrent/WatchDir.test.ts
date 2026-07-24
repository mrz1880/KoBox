import { describe, expect, it } from 'vitest';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { WatchDir } from '../../../../src/domain/torrent/WatchDir.js';

describe('WatchDir', () => {
  it('should_expose_the_root_watch_layout_without_label', () => {
    const root = WatchDir.root();
    expect(root.label).toBeUndefined();
    expect(root.watchPath('/home/alice')).toBe('/home/alice/rtorrent/watch');
    expect(root.completePath('/home/alice')).toBe('/home/alice/rtorrent/complete');
    expect(root.torrentsPath('/home/alice')).toBe('/home/alice/rtorrent/torrents');
  });

  it('should_scope_the_layout_under_the_label', () => {
    const films = WatchDir.labeled(Label.parse('films'));
    expect(films.label?.value).toBe('films');
    expect(films.watchPath('/home/alice')).toBe('/home/alice/rtorrent/watch/films');
    expect(films.completePath('/home/alice')).toBe('/home/alice/rtorrent/complete/films');
    expect(films.torrentsPath('/home/alice')).toBe('/home/alice/rtorrent/torrents/films');
  });

  it('should_compare_by_label', () => {
    expect(WatchDir.root().equals(WatchDir.root())).toBe(true);
    expect(WatchDir.labeled(Label.parse('films')).equals(WatchDir.labeled(Label.parse('films')))).toBe(true);
    expect(WatchDir.labeled(Label.parse('films')).equals(WatchDir.root())).toBe(false);
  });
});
