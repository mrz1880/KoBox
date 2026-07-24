import { describe, expect, it } from 'vitest';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
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

  it('should_restore_from_persistence_without_emitting_events', () => {
    const restored = TorrentInstance.restore({
      username: Username.parse('bob'),
      scgiPort: ScgiPort.parse(51102),
      rtorrentPort: RtorrentPort.parse(45002),
      watchDirs: provisioned().watchDirs,
      allowPublicTracker: true,
      syncDisabled: true,
    });
    expect(restored.username.value).toBe('bob');
    expect(restored.allowPublicTracker).toBe(true);
    expect(restored.syncDisabled).toBe(true);
  });
});
