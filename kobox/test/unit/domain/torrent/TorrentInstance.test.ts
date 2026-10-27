import { describe, expect, it } from 'vitest';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { RecyclingMode } from '../../../../src/domain/torrent/RecyclingMode.js';
import {
  FolderNameTakenError,
  TorrentInstance,
} from '../../../../src/domain/torrent/TorrentInstance.js';
import { SyncMode } from '../../../../src/domain/torrent/SyncMode.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';

function provisioned(): TorrentInstance {
  return TorrentInstance.provision({
    username: Username.parse('alice'),
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45001),
  }).instance;
}

describe('TorrentInstance', () => {
  it('should_provision_with_the_root_watch_dir_and_conservative_flags', () => {
    const { instance, event } = TorrentInstance.provision({
      username: Username.parse('alice'),
      scgiPort: ScgiPort.parse(51101),
      rtorrentPort: RtorrentPort.parse(45001),
    });
    expect(instance.username.value).toBe('alice');
    expect(instance.watchDirs).toHaveLength(1);
    expect(instance.watchDirs[0]?.label).toBeUndefined();
    expect(instance.allowPublicTracker).toBe(false);
    expect(instance.syncDisabled).toBe(false);
    expect(event).toEqual({ type: 'RtorrentInstanceProvisioned', username: 'alice' });
  });

  it('should_add_a_labeled_watch_dir_once', () => {
    const films = Label.parse('films');
    const { instance: withFilms, event } = provisioned().addWatchDir(films);
    expect(withFilms.watchDirs.map((dir) => dir.label?.value)).toEqual([undefined, 'films']);
    expect(event).toEqual({ type: 'WatchDirAdded', username: 'alice', label: 'films' });

    const { instance: again, event: none } = withFilms.addWatchDir(films);
    expect(again).toBe(withFilms); // idempotent: same aggregate, no event
    expect(none).toBeUndefined();
  });

  it('should_remove_a_folder_and_shrug_at_one_already_gone', () => {
    const films = Label.parse('films');
    const withFilms = provisioned().addWatchDir(films).instance;

    const without = withFilms.removeWatchDir(films);

    expect(without.watchDirs.map((dir) => dir.label?.value)).toEqual([undefined]);
    // a job run twice finds nothing the second time: that is not an error
    expect(without.removeWatchDir(films)).toBe(without);
  });

  it('should_rename_a_folder_and_keep_what_happens_to_its_downloads', () => {
    const films = Label.parse('films');
    const movies = Label.parse('Movies');
    const instance = provisioned()
      .addWatchDir(films)
      .instance.setSyncMode(films, SyncMode.parse('immediate'));

    const renamed = instance.renameWatchDir(films, movies);

    expect(renamed.watchDirs.map((dir) => [dir.label?.value, dir.syncMode.value])).toEqual([
      [undefined, 'off'],
      ['Movies', 'immediate'],
    ]);
    // run again, the old name is gone and the new one there: already done
    expect(renamed.renameWatchDir(films, movies)).toBe(renamed);
  });

  it('should_tell_whether_a_folder_sends_what_finishes_in_it', () => {
    const films = Label.parse('films');
    const kept = provisioned().addWatchDir(films).instance;

    expect(kept.sendsFolder(films)).toBe(false);
    expect(kept.setSyncMode(films, SyncMode.parse('scheduled')).sendsFolder(films)).toBe(true);
    expect(kept.sendsFolder(Label.parse('series'))).toBe(false);
  });

  it('should_refuse_to_rename_a_folder_onto_one_that_exists', () => {
    const films = Label.parse('films');
    const series = Label.parse('series');
    const instance = provisioned().addWatchDir(films).instance.addWatchDir(series).instance;

    expect(() => instance.renameWatchDir(films, series)).toThrow(FolderNameTakenError);
  });

  it('should_flip_flags_immutably_and_idempotently', () => {
    const instance = provisioned();
    const allowed = instance.setAllowPublicTracker(true);
    expect(allowed.allowPublicTracker).toBe(true);
    expect(instance.allowPublicTracker).toBe(false); // original untouched
    expect(allowed.setAllowPublicTracker(true)).toBe(allowed); // no-op returns same

    const synced = instance.setSyncDisabled(true);
    expect(synced.syncDisabled).toBe(true);
    expect(synced.setSyncDisabled(false).syncDisabled).toBe(false);
  });

  it('should_admit_private_torrents_always_and_public_only_when_allowed', () => {
    const instance = provisioned();
    expect(instance.admitTorrent('private')).toBe('accepted');
    expect(instance.admitTorrent('public')).toBe('rejected-public-tracker');
    expect(instance.setAllowPublicTracker(true).admitTorrent('public')).toBe('accepted');
  });

  it.each([
    ['/home/alice/rtorrent/watch/x.torrent', true],
    ['/home/alice/rtorrent/watch/films/x.torrent', true],
    // ruTorrent's upload form: its owner chose whether to start it
    ['/home/alice/rtorrent/torrents/x.torrent', false],
    // a sibling that merely shares the prefix is not a watch folder
    ['/home/alice/rtorrent/watchlist/x.torrent', false],
    ['/home/bob/rtorrent/watch/x.torrent', false],
  ])('should_start_only_what_was_dropped_into_a_watch_folder: %s', (file, starts) => {
    const instance = provisioned().addWatchDir(Label.parse('films')).instance;
    expect(instance.startsOnceAdmitted(file, '/home/alice/')).toBe(starts);
  });

  // MySB moved the .torrent out of watch once added, into torrents/ under the
  // same folder: watch is a drop box, torrents/ is the record
  it.each([
    ['/home/alice/rtorrent/watch/films/x.torrent', '/home/alice/rtorrent/torrents/films'],
    ['/home/alice/rtorrent/watch/x.torrent', '/home/alice/rtorrent/torrents'],
    ['/home/alice/rtorrent/watch/series/x.torrent', undefined],
    ['/home/alice/elsewhere/x.torrent', undefined],
  ])('should_file_a_dropped_torrent_under_torrents_in_its_folder: %s', (file, folder) => {
    const instance = provisioned().addWatchDir(Label.parse('films')).instance;
    expect(instance.torrentsFolderFor(file, '/home/alice/')).toBe(folder);
  });

  it('should_restore_from_persistence_without_emitting_events', () => {
    const restored = TorrentInstance.restore({
      username: Username.parse('bob'),
      scgiPort: ScgiPort.parse(51102),
      rtorrentPort: RtorrentPort.parse(45002),
      watchDirs: provisioned().watchDirs,
      allowPublicTracker: true,
      recycling: RecyclingMode.none,
      syncDisabled: true,
    });
    expect(restored.username.value).toBe('bob');
    expect(restored.allowPublicTracker).toBe(true);
    expect(restored.syncDisabled).toBe(true);
  });
});
