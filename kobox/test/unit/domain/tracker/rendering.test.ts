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
