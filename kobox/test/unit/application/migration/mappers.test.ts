import { describe, expect, it } from 'vitest';
import {
  toBlocklist,
  toMappedAddress,
  toMappedUser,
  toTorrent,
  toTracker,
} from '../../../../src/application/migration/mappers.js';
import type {
  MysbBlocklist,
  MysbTorrent,
  MysbTracker,
  MysbUser,
} from '../../../../src/application/migration/MysbSourcePort.js';

const userDto: MysbUser = {
  username: 'alice',
  email: 'alice@example.org',
  scgiPort: 51101,
  rtorrentPort: 45000,
  proxyPort: 8080,
  quotaBytes: 442_381_107_200,
  accountType: 'normal',
  active: true,
  syncDisabled: false,
  categories: [],
};

describe('toMappedUser', () => {
  it('should_preserve_ports_quota_and_type', () => {
    const user = toMappedUser(userDto);

    expect(user.username.value).toBe('alice');
    expect(user.scgiPort.value).toBe(51101);
    expect(user.rtorrentPort.value).toBe(45000);
    expect(user.proxyPort.value).toBe(8080);
    expect(user.quota.toBytes()).toBe(442_381_107_200);
    expect(user.accountType.value).toBe('normal');
    expect(user.suspended).toBe(false);
  });

  it('should_mark_an_inactive_user_suspended', () => {
    expect(toMappedUser({ ...userDto, active: false }).suspended).toBe(true);
  });

  it('should_carry_the_sync_disabled_flag', () => {
    expect(toMappedUser({ ...userDto, syncDisabled: true }).syncDisabled).toBe(true);
  });

  it('should_reject_a_reserved_username', () => {
    expect(() => toMappedUser({ ...userDto, username: 'root' })).toThrow();
  });
});

describe('toTracker', () => {
  const trackerDto: MysbTracker = {
    host: 'tracker.example.org',
    proto: 'https',
    port: 443,
    privacy: 'private',
    isActive: true,
    isDead: false,
    isSsl: true,
    ipv4: ['192.0.2.10', '192.0.2.11'],
  };

  it('should_restore_identity_and_leave_the_cert_to_be_refetched', () => {
    const tracker = toTracker(trackerDto);

    expect(tracker.host.value).toBe('tracker.example.org');
    expect(tracker.privacy.value).toBe('private');
    expect(tracker.isSsl).toBe(true);
    // import identity only; KoBox re-fetches the real cert
    expect(tracker.checkState.value).toBe('pending');
    expect(tracker.certExpiry).toBeUndefined();
    expect(tracker.ipv4.map((ip) => ip.value)).toEqual(['192.0.2.10', '192.0.2.11']);
  });

  it('should_not_schedule_a_check_for_a_udp_tracker', () => {
    const tracker = toTracker({ ...trackerDto, proto: 'udp', isSsl: false });
    expect(tracker.checkState.value).toBe('none');
  });

  it('should_not_schedule_a_check_for_a_dead_tracker', () => {
    const tracker = toTracker({ ...trackerDto, isDead: true });
    expect(tracker.checkState.value).toBe('none');
  });
});

describe('toBlocklist', () => {
  const blocklistDto: MysbBlocklist = {
    source: 'iblocklist',
    author: 'level1',
    name: 'Level 1',
    url: 'https://lists.example.net/level1.gz',
    subscription: true,
    enabled: true,
  };

  it('should_restore_a_blocklist', () => {
    const blocklist = toBlocklist(blocklistDto);
    expect(blocklist.source.value).toBe('iblocklist');
    expect(blocklist.name).toBe('Level 1');
    expect(blocklist.enabled).toBe(true);
  });
});

describe('toTorrent', () => {
  const torrentDto: MysbTorrent = {
    username: 'alice',
    infoHash: 'A'.repeat(40),
    name: 'Some.Neutral.Release',
    label: 'movies',
    state: 'completed',
  };

  it('should_restore_a_torrent_scoped_to_its_user', () => {
    const { username, torrent } = toTorrent(torrentDto);
    expect(username.value).toBe('alice');
    expect(torrent.infoHash.value).toBe('A'.repeat(40));
    expect(torrent.state.value).toBe('completed');
    expect(torrent.label?.value).toBe('movies');
  });

  it('should_handle_a_missing_label', () => {
    const { torrent } = toTorrent({ ...torrentDto, label: undefined });
    expect(torrent.label).toBeUndefined();
  });
});

describe('toMappedAddress', () => {
  it('should_map_an_ipv4_row', () => {
    const mapped = toMappedAddress({ username: 'alice', value: '192.0.2.50', kind: 'ipv4' });
    if (mapped.kind !== 'ipv4') throw new Error('expected ipv4');
    expect(mapped.ip.value).toBe('192.0.2.50');
  });

  it('should_map_a_hostname_row', () => {
    const mapped = toMappedAddress({ username: 'alice', value: 'dyn.example.org', kind: 'hostname' });
    if (mapped.kind !== 'hostname') throw new Error('expected hostname');
    expect(mapped.hostname.value).toBe('dyn.example.org');
  });
});

describe('categories', () => {
  function withCategories(categories: { name: string; syncMode: number }[]) {
    return toMappedUser({ ...userDto, categories });
  }

  it('should_bring_each_folder_across_with_what_it_does_to_a_finished_download', () => {
    // MySB stored 0, 1, 2 in a column and decoded them in bash. These are the
    // values a live box actually carries.
    const mapped = withCategories([
      { name: 'Films', syncMode: 2 },
      { name: 'Travail', syncMode: 1 },
      { name: 'Autres', syncMode: 0 },
    ]);

    expect(
      mapped.watchDirs
        .filter((dir) => dir.label !== undefined)
        .map((dir) => `${dir.label?.value ?? ''}=${dir.syncMode.value}`),
    ).toEqual(['Films=immediate', 'Travail=scheduled', 'Autres=off']);
  });

  it('should_always_keep_the_unlabelled_root', () => {
    // everything downloaded without a label lives there, on every box
    expect(withCategories([]).watchDirs.filter((dir) => dir.label === undefined)).toHaveLength(1);
  });

  it('should_drop_a_folder_whose_name_could_not_be_a_directory_and_keep_the_rest', () => {
    // one unusable folder must cost a member that folder, not their account
    const mapped = withCategories([
      { name: 'Films', syncMode: 2 },
      { name: '../escape', syncMode: 2 },
    ]);

    expect(mapped.watchDirs.filter((dir) => dir.label !== undefined)).toHaveLength(1);
  });

  it('should_treat_a_mode_it_does_not_recognise_as_sending_nothing', () => {
    // a value outside 0-2 is corruption; the safe reading is "do not send"
    expect(withCategories([{ name: 'Films', syncMode: 9 }]).watchDirs[1]?.syncMode.value).toBe(
      'off',
    );
  });
});

describe('blocklist urls from a legacy box', () => {
  const legacyList = {
    source: 'iblocklist' as const,
    author: 'I-Blocklist',
    name: 'Level 1',
    url: 'http://list.iblocklist.com/?list=bt_level1&fileformat=p2p&archiveformat=gz',
    subscription: true,
    enabled: true,
  };

  it('should_bring_an_http_list_across_as_https', () => {
    // Every blocklist on a live MySB box is http. KoBox refuses http on purpose
    // — an altered list feeds the kernel's IP filter — so dropping them would
    // cost a member their whole blocklist configuration at cutover. The host
    // serves https, so the repair is the same list over a transport we accept.
    expect(toBlocklist(legacyList).url.value).toBe(
      'https://list.iblocklist.com/?list=bt_level1&fileformat=p2p&archiveformat=gz',
    );
  });

  it('should_leave_an_https_list_exactly_as_it_is', () => {
    const already = { ...legacyList, url: 'https://example.org/list.gz' };

    expect(toBlocklist(already).url.value).toBe('https://example.org/list.gz');
  });

  it('should_still_refuse_something_that_is_not_a_url_at_all', () => {
    // the repair is a scheme upgrade, not a licence to accept anything
    expect(() => toBlocklist({ ...legacyList, url: 'ftp://example.org/list' })).toThrow();
    expect(() => toBlocklist({ ...legacyList, url: 'not a url' })).toThrow();
  });
});
