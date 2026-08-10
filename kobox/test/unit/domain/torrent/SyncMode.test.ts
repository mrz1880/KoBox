import { describe, expect, it } from 'vitest';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { InvalidSyncModeError, SyncMode } from '../../../../src/domain/torrent/SyncMode.js';
import { WatchDir } from '../../../../src/domain/torrent/WatchDir.js';
import {
  TorrentInstance,
  UnknownCategoryError,
} from '../../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';

describe('SyncMode', () => {
  it('should_accept_the_three_modes_a_member_can_choose', () => {
    for (const mode of SyncMode.all()) {
      expect(SyncMode.parse(mode.value).value, mode.value).toBe(mode.value);
    }
  });

  it('should_refuse_anything_else', () => {
    for (const bad of ['', 'yes', '1', 'direct']) {
      expect(() => SyncMode.parse(bad), bad).toThrow(InvalidSyncModeError);
    }
  });

  it('should_know_which_modes_send_anything_at_all', () => {
    expect(SyncMode.off.sends).toBe(false);
    expect(SyncMode.scheduled.sends).toBe(true);
    expect(SyncMode.immediate.sends).toBe(true);
  });

  it('should_know_which_mode_cannot_wait_for_the_next_pass', () => {
    expect(SyncMode.immediate.isImmediate).toBe(true);
    expect(SyncMode.scheduled.isImmediate).toBe(false);
  });
});

describe('WatchDir sync mode', () => {
  it('should_default_a_new_category_to_sending_nothing', () => {
    // turning sync on is a member's decision about their own machine; a
    // category that starts pushing the moment it is created never was
    expect(WatchDir.labeled(Label.parse('films')).syncMode).toBe(SyncMode.off);
  });

  it('should_carry_the_mode_a_member_chose', () => {
    const dir = WatchDir.labeled(Label.parse('films')).withSyncMode(SyncMode.immediate);

    expect(dir.syncMode).toBe(SyncMode.immediate);
    expect(dir.label?.value).toBe('films');
  });

  it('should_never_let_the_unlabelled_root_be_synchronised', () => {
    // the root is everything without a label: pushing it would push the whole
    // library on every finish, which is not what "sync my films" means
    expect(() => WatchDir.root().withSyncMode(SyncMode.immediate)).toThrow();
  });
});

describe('TorrentInstance categories', () => {
  const instance = TorrentInstance.provision({
    username: Username.parse('alice'),
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45000),
  }).instance;

  it('should_set_the_mode_of_a_category_it_owns', () => {
    const withFilms = instance.addWatchDir(Label.parse('films')).instance;

    const updated = withFilms.setSyncMode(Label.parse('films'), SyncMode.scheduled);

    expect(updated.watchDirs.find((dir) => dir.label?.value === 'films')?.syncMode).toBe(
      SyncMode.scheduled,
    );
  });

  it('should_refuse_a_category_that_does_not_exist_on_this_instance', () => {
    // otherwise a member could set a mode on somebody else's label, or on one
    // whose directories were never created
    expect(() => instance.setSyncMode(Label.parse('films'), SyncMode.scheduled)).toThrow(
      UnknownCategoryError,
    );
  });

  it('should_leave_the_other_categories_alone', () => {
    const both = instance
      .addWatchDir(Label.parse('films')).instance
      .addWatchDir(Label.parse('series')).instance;

    const updated = both.setSyncMode(Label.parse('films'), SyncMode.immediate);

    expect(updated.watchDirs.find((dir) => dir.label?.value === 'series')?.syncMode).toBe(
      SyncMode.off,
    );
  });
});
