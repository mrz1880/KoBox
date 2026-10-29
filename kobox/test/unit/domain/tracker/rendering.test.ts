import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { Tracker } from '../../../../src/domain/tracker/Tracker.js';
import { TrackerHost } from '../../../../src/domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../../../src/domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../../../src/domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../../../src/domain/tracker/TrackerProto.js';
import {
  mergeBlocklistRanges,
  renderBlacklistZones,
  renderBlockedNames,
  renderIpsetRestore,
  renderUserBlocklistDropin,
  renderUserBlocklistFile,
} from '../../../../src/domain/tracker/rendering.js';
import { Username } from '../../../../src/domain/user/Username.js';

// Golden files: byte-for-byte expected renders, reviewed at diff time.
// Regenerate deliberately with: UPDATE_GOLDEN=1 pnpm test:unit
const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/tracker');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

function tracker(
  host: string,
  proto: 'http' | 'https' | 'udp',
  port: number,
  ips: readonly string[],
): Tracker {
  const discovered = Tracker.discover({
    host: TrackerHost.parse(host),
    proto: TrackerProto.parse(proto),
    port: TrackerPort.parse(port),
    privacy: TrackerPrivacy.parse('private'),
  }).tracker;
  return discovered.updateAddresses(ips.map((ip) => IpAddress.parse(ip)));
}

const activeHttps = tracker('tracker.example.org', 'https', 443, ['192.0.2.11', '192.0.2.10']);
const activeUdp = tracker('udp.example.io', 'udp', 6969, ['192.0.2.20']);
const dead = tracker('dead.example.net', 'http', 80, []).markDead().tracker;
const fixtures = [activeUdp, dead, activeHttps];

describe('renderBlacklistZones', () => {
  it('should_list_only_inactive_trackers_as_bind_zones', () => {
    const file = renderBlacklistZones(fixtures);
    expect(file.path).toBe('/etc/bind/kobox.zones.blacklists');
    expect(file.mode).toBe('0644');
    expect(file.owner).toBe('root');
    expect(file.content).toContain(
      'zone "dead.example.net" { type master; file "/etc/bind/db.empty"; };',
    );
    expect(file.content).not.toContain('tracker.example.org');
    expectGolden('zones.blacklists.golden', file.content);
  });
});

describe('renderBlockedNames', () => {
  it('should_list_only_inactive_trackers_for_dnscrypt', () => {
    const file = renderBlockedNames(fixtures);
    expect(file.path).toBe('/etc/dnscrypt-proxy/blocked-names.txt');
    expect(file.content).toContain('dead.example.net');
    expect(file.content).not.toContain('udp.example.io');
    expectGolden('blocked-names.txt.golden', file.content);
  });
});

describe('renderIpsetRestore', () => {
  // pgl is retired (Phase 5): the merged ranges land in a kernel ipset via
  // the atomic staging-set + swap pattern.
  it('should_render_the_staging_swap_pattern_over_the_merged_ranges', () => {
    const file = renderIpsetRestore(['9.9.9.9-9.9.9.9', '10.0.0.0/8', '192.0.2.0-192.0.2.255']);
    expect(file.path).toBe('/etc/kobox/blocklist.ipset');
    const lines = file.content.trimEnd().split('\n');
    expect(lines[0]).toBe('create kobox-bl hash:net family inet maxelem 1048576 -exist');
    expect(lines[1]).toBe('create kobox-bl-next hash:net family inet maxelem 1048576 -exist');
    expect(lines[2]).toBe('flush kobox-bl-next');
    expect(lines).toContain('add kobox-bl-next 10.0.0.0/8');
    expect(lines).toContain('add kobox-bl-next 9.9.9.9-9.9.9.9');
    expect(lines.at(-2)).toBe('swap kobox-bl kobox-bl-next');
    expect(lines.at(-1)).toBe('destroy kobox-bl-next');
    expectGolden('blocklist.ipset.golden', file.content);
  });

  it('should_drop_lines_that_are_not_plain_ranges_or_cidrs', () => {
    const file = renderIpsetRestore([
      '192.0.2.0/24',
      '198.51.100.1-198.51.100.9',
      '203.0.113.7',
      '10.0.0.0/8 extra',
      'add evil-set 1.2.3.4',
      '1.2.3.4-',
    ]);
    const adds = file.content.split('\n').filter((line) => line.startsWith('add '));
    expect(adds).toEqual([
      'add kobox-bl-next 192.0.2.0/24',
      'add kobox-bl-next 198.51.100.1-198.51.100.9',
      'add kobox-bl-next 203.0.113.7',
    ]);
  });

  it('should_render_an_empty_swap_when_there_are_no_ranges', () => {
    const file = renderIpsetRestore([]);
    expect(file.content).toContain('flush kobox-bl-next');
    expect(file.content).not.toContain('add ');
  });
});

describe('renderUserBlocklistDropin', () => {
  it('should_load_the_filter_and_schedule_a_daily_reload_when_enabled', () => {
    const file = renderUserBlocklistDropin(Username.parse('alice'), true);
    expect(file.path).toBe('/home/alice/rtorrent/config.d/80-blocklist.rc');
    expect(file.mode).toBe('0640');
    expect(file.group).toBe('alice');
    expect(file.content).toContain(
      'ipv4_filter.load = /home/alice/blocklist/blocklist_rtorrent.txt, unwanted',
    );
    expect(file.content).toContain('schedule2 = load_filter,0,24:00:00');
    expectGolden('80-blocklist.rc.golden', file.content);
  });

  it('should_render_a_comment_only_dropin_when_disabled', () => {
    const file = renderUserBlocklistDropin(Username.parse('alice'), false);
    expect(file.content).not.toContain('ipv4_filter.load');
    expect(file.content.trimEnd().split('\n').every((line) => line.startsWith('#'))).toBe(true);
  });
});

describe('mergeBlocklistRanges', () => {
  it('should_filter_clean_sort_and_dedupe_like_the_legacy_pipeline', () => {
    const merged = mergeBlocklistRanges([
      ['192.0.2.0-192.0.2.255', 'bad line with spaces', 'no-digit-start'],
      ['10.0.0.0/8', '192.0.2.0-192.0.2.255', 'nodots'],
      ['9.9.9.9-9.9.9.9'],
    ]);
    expect(merged).toEqual(['9.9.9.9-9.9.9.9', '10.0.0.0/8', '192.0.2.0-192.0.2.255']);
  });

  it('should_return_empty_for_no_input', () => {
    expect(mergeBlocklistRanges([])).toEqual([]);
  });
});

describe('renderUserBlocklistFile', () => {
  it('should_render_the_merged_ranges_for_a_user', () => {
    const file = renderUserBlocklistFile(
      Username.parse('alice'),
      mergeBlocklistRanges([['192.0.2.0-192.0.2.255', '10.0.0.0/8']]),
    );
    expect(file.path).toBe('/home/alice/blocklist/blocklist_rtorrent.txt');
    expect(file.owner).toBe('root');
    expect(file.group).toBe('alice');
    expectGolden('blocklist_rtorrent.txt.golden', file.content);
  });
});

describe('tracker rendering boundaries', () => {
  const deadAlpha = tracker('alpha.example.org', 'http', 80, []).markDead().tracker;
  const deadZulu = tracker('zulu.example.org', 'http', 80, []).markDead().tracker;

  it('should_list_inactive_trackers_in_host_order_whatever_the_input_order', () => {
    const names = renderBlockedNames([deadZulu, activeHttps, deadAlpha]);
    expect(names.content).toBe(
      ['# KoBox - blocked names (inactive trackers)', 'alpha.example.org', 'zulu.example.org', ''].join(
        '\n',
      ),
    );
    const zones = renderBlacklistZones([deadZulu, deadAlpha]).content.split('\n');
    expect(zones[1]).toContain('"alpha.example.org"');
    expect(zones[2]).toContain('"zulu.example.org"');
  });

  it('should_write_the_network_files_as_root_readable_by_everyone', () => {
    for (const file of [
      renderBlacklistZones(fixtures),
      renderBlockedNames(fixtures),
      renderIpsetRestore([]),
    ]) {
      expect([file.mode, file.owner, file.group], file.path).toEqual(['0644', 'root', 'root']);
    }
  });

  it('should_render_the_ipset_stream_with_a_trailing_newline', () => {
    expect(renderIpsetRestore([]).content).toBe(
      [
        'create kobox-bl hash:net family inet maxelem 1048576 -exist',
        'create kobox-bl-next hash:net family inet maxelem 1048576 -exist',
        'flush kobox-bl-next',
        'swap kobox-bl kobox-bl-next',
        'destroy kobox-bl-next',
        '',
      ].join('\n'),
    );
  });

  it('should_refuse_ipset_entries_with_anything_before_or_after_the_address', () => {
    const file = renderIpsetRestore([
      'x192.0.2.1',
      '192.0.2.1x',
      '192.0.2.1/24x',
      '192.0.2',
      '1234.0.2.1',
      '192.0.2.1/123',
      '192.0.2.1-198.51.100',
      '192.0.2.1\nflush kobox-bl',
    ]);
    expect(file.content).not.toContain('add ');
  });

  it('should_accept_the_shortest_and_longest_well_formed_entries', () => {
    const file = renderIpsetRestore(['1.2.3.4/8', '192.0.2.255/32', '1.2.3.4-5.6.7.8']);
    const adds = file.content.split('\n').filter((line) => line.startsWith('add '));
    expect(adds).toEqual([
      'add kobox-bl-next 1.2.3.4/8',
      'add kobox-bl-next 192.0.2.255/32',
      'add kobox-bl-next 1.2.3.4-5.6.7.8',
    ]);
  });

  it('should_render_the_disabled_dropin_as_one_inert_comment_for_the_member', () => {
    const file = renderUserBlocklistDropin(Username.parse('alice'), false);
    expect(file.content).toBe(
      [
        '# KoBox-managed file for alice \u2014 DO NOT EDIT.',
        '# No blocklist enabled \u2014 this drop-in is intentionally inert.',
        '',
      ].join('\n'),
    );
    expect([file.mode, file.owner, file.group]).toEqual(['0640', 'root', 'alice']);
  });

  it('should_report_the_loaded_filter_size_when_enabled', () => {
    const file = renderUserBlocklistDropin(Username.parse('alice'), true);
    expect(file.content.split('\n')).toContain(
      'print = "IPv4 filter list size data:",(to_kb,(ipv4_filter.size_data))," kb."',
    );
    expect(file.content.split('\n')).toContain(
      'schedule2 = load_filter,0,24:00:00,"ipv4_filter.load = /home/alice/blocklist/blocklist_rtorrent.txt, unwanted"',
    );
  });

  it('should_write_the_member_blocklist_one_range_per_line', () => {
    const file = renderUserBlocklistFile(Username.parse('alice'), ['10.0.0.0/8', '192.0.2.0/24']);
    expect(file.content).toBe('10.0.0.0/8\n192.0.2.0/24\n');
    expect(file.mode).toBe('0640');
  });
});

describe('mergeBlocklistRanges boundaries', () => {
  it('should_trim_lines_before_keeping_them', () => {
    expect(mergeBlocklistRanges([['  192.0.2.0/24\t', '\t']])).toEqual(['192.0.2.0/24']);
  });

  it('should_drop_blank_lines_lines_with_inner_spaces_and_lines_not_starting_with_a_digit', () => {
    expect(
      mergeBlocklistRanges([['', '   ', '192.0.2.0 /24', 'a192.0.2.0/24', '#192.0.2.0/24', '1.2.3.4']]),
    ).toEqual(['1.2.3.4']);
  });

  it('should_keep_a_line_with_a_dot_and_drop_one_without', () => {
    expect(mergeBlocklistRanges([['1234', '1.2']])).toEqual(['1.2']);
  });

  it('should_order_ranges_numerically_by_their_first_address', () => {
    // a string sort would put 192 before 20 and 9
    expect(
      mergeBlocklistRanges([['192.0.2.0/24', '20.0.0.0-20.0.0.9', '9.0.0.0/8', '20.0.0.0/8', '9.255.0.0/16']]),
    ).toEqual(['9.0.0.0/8', '9.255.0.0/16', '20.0.0.0-20.0.0.9', '20.0.0.0/8', '192.0.2.0/24']);
  });

  it('should_weigh_each_octet_by_its_position', () => {
    expect(mergeBlocklistRanges([['1.0.0.0', '0.255.255.255', '0.0.1.0', '0.0.0.255']])).toEqual([
      '0.0.0.255',
      '0.0.1.0',
      '0.255.255.255',
      '1.0.0.0',
    ]);
  });

  it('should_break_ties_between_ranges_starting_at_the_same_address_alphabetically', () => {
    expect(mergeBlocklistRanges([['192.0.2.0/24', '192.0.2.0-192.0.2.9', '192.0.2.0/25']])).toEqual([
      '192.0.2.0-192.0.2.9',
      '192.0.2.0/24',
      '192.0.2.0/25',
    ]);
  });
});
