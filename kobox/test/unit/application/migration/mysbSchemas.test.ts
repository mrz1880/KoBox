import { describe, expect, it } from 'vitest';
import {
  mysbAddressSchema,
  mysbBlocklistSchema,
  mysbTorrentSchema,
  mysbTrackerRowSchema,
  mysbUserSchema,
} from '../../../../src/application/migration/mysbSchemas.js';

describe('mysbUserSchema', () => {
  const valid = {
    username: 'alice',
    email: 'alice@example.org',
    scgi_port: 51101,
    rtorrent_port: 45000,
    proxy_port: 8080,
    quota_bytes: 442381107200,
    account_type: 'normal',
    active: 1,
  };

  it('should_parse_a_valid_user_row_into_a_camelcase_dto', () => {
    const user = mysbUserSchema.parse(valid);

    expect(user.username).toBe('alice');
    expect(user.scgiPort).toBe(51101);
    expect(user.rtorrentPort).toBe(45000);
    expect(user.proxyPort).toBe(8080);
    expect(user.accountType).toBe('normal');
    expect(user.active).toBe(true);
  });

  it('should_map_active_zero_to_false', () => {
    expect(mysbUserSchema.parse({ ...valid, active: 0 }).active).toBe(false);
  });

  it('should_reject_a_malformed_username', () => {
    expect(() => mysbUserSchema.parse({ ...valid, username: 'Bad Name' })).toThrow();
  });

  it('should_reject_an_unknown_account_type', () => {
    expect(() => mysbUserSchema.parse({ ...valid, account_type: 'wizard' })).toThrow();
  });

  it('should_reject_an_out_of_range_port', () => {
    expect(() => mysbUserSchema.parse({ ...valid, scgi_port: 70000 })).toThrow();
  });
});

describe('mysbTorrentSchema', () => {
  const valid = {
    username: 'alice',
    info_hash: 'a'.repeat(40),
    name: 'Some.Neutral.Release',
    label: 'movies',
    state: 'completed',
  };

  it('should_uppercase_the_info_hash', () => {
    expect(mysbTorrentSchema.parse(valid).infoHash).toBe('A'.repeat(40));
  });

  it('should_treat_a_null_label_as_absent', () => {
    expect(mysbTorrentSchema.parse({ ...valid, label: null }).label).toBeUndefined();
  });

  it('should_reject_a_malformed_info_hash', () => {
    expect(() => mysbTorrentSchema.parse({ ...valid, info_hash: 'nothex' })).toThrow();
  });

  it('should_reject_an_unknown_state', () => {
    expect(() => mysbTorrentSchema.parse({ ...valid, state: 'seeding' })).toThrow();
  });
});

describe('mysbAddressSchema', () => {
  it('should_parse_an_ipv4_row', () => {
    const row = mysbAddressSchema.parse({ username: 'alice', value: '192.0.2.10', kind: 'ipv4' });
    expect(row.kind).toBe('ipv4');
    expect(row.value).toBe('192.0.2.10');
  });

  it('should_parse_a_hostname_row', () => {
    const row = mysbAddressSchema.parse({ username: 'alice', value: 'dyn.example.org', kind: 'hostname' });
    expect(row.kind).toBe('hostname');
  });

  it('should_reject_an_unknown_kind', () => {
    expect(() => mysbAddressSchema.parse({ username: 'alice', value: 'x', kind: 'ipv6' })).toThrow();
  });
});

describe('mysbTrackerRowSchema', () => {
  const valid = {
    host: 'tracker.example.org',
    proto: 'https',
    port: 443,
    privacy: 'private',
    is_active: 1,
    is_dead: 0,
    is_ssl: 1,
  };

  it('should_parse_flags_to_booleans', () => {
    const tracker = mysbTrackerRowSchema.parse(valid);
    expect(tracker.isActive).toBe(true);
    expect(tracker.isDead).toBe(false);
    expect(tracker.isSsl).toBe(true);
    expect(tracker.privacy).toBe('private');
  });

  it('should_reject_an_unknown_proto', () => {
    expect(() => mysbTrackerRowSchema.parse({ ...valid, proto: 'gopher' })).toThrow();
  });
});

describe('mysbBlocklistSchema', () => {
  const valid = {
    source: 'iblocklist',
    author: 'level1',
    name: 'Level 1',
    url: 'https://lists.example.net/level1.gz',
    subscription: 1,
    enabled: 1,
  };

  it('should_parse_a_blocklist_row', () => {
    const list = mysbBlocklistSchema.parse(valid);
    expect(list.source).toBe('iblocklist');
    expect(list.subscription).toBe(true);
    expect(list.enabled).toBe(true);
  });

  it('should_reject_an_unknown_source', () => {
    expect(() => mysbBlocklistSchema.parse({ ...valid, source: 'evil' })).toThrow();
  });
});
