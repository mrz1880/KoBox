import type { RenderedFile } from '../shared/files.js';
import type { Username } from '../user/Username.js';
import type { Tracker } from './Tracker.js';
import type { UserAddress } from './ports.js';

// Pure, deterministic renders of the whole desired state of each network
// file. The legacy built these with appended `echo`/`sed -i` passes over live
// files (AUDIT §5.2); here content is a function of the domain state only.

const ROOT_FILE = { mode: '0644', owner: 'root', group: 'root' } as const;

function byHost(a: Tracker, b: Tracker): number {
  return a.host.value.localeCompare(b.host.value);
}

function inactive(trackers: readonly Tracker[]): readonly Tracker[] {
  return trackers.filter((tracker) => !tracker.isActive).sort(byHost);
}

export function renderBlacklistZones(trackers: readonly Tracker[]): RenderedFile {
  const zones = inactive(trackers).map(
    (tracker) =>
      `zone "${tracker.host.value}" { type master; file "/etc/bind/db.empty"; };`,
  );
  return {
    path: '/etc/bind/kobox.zones.blacklists',
    content: ['#### KoBox - Blacklisted domains (ex: inactive trackers)', ...zones, ''].join('\n'),
    ...ROOT_FILE,
  };
}

export function renderBlockedNames(trackers: readonly Tracker[]): RenderedFile {
  const names = inactive(trackers).map((tracker) => tracker.host.value);
  return {
    path: '/etc/dnscrypt-proxy/blocked-names.txt',
    content: ['# KoBox - blocked names (inactive trackers)', ...names, ''].join('\n'),
    ...ROOT_FILE,
  };
}

const ALLOW_P2P_HEADER = `# allow.p2p - allow list for pglcmd
#
# This file contains IP ranges that shall not be checked.
# They must be in the PeerGuardian .p2p text format like this:
#   Some organization:1.0.0.0-1.255.255.255
# Lines beginning with a hash (#) are comments and will be ignored.
#
# KoBox-managed file — DO NOT EDIT (rendered declaratively).`;

function ipSortKey(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

export function renderAllowP2p(
  users: readonly UserAddress[],
  trackers: readonly Tracker[],
): RenderedFile {
  const lines: string[] = [ALLOW_P2P_HEADER];

  const userLines = [...users]
    .sort(
      (a, b) =>
        a.username.value.localeCompare(b.username.value) ||
        ipSortKey(a.ip.value) - ipSortKey(b.ip.value),
    )
    .map((address) => `${address.username.value}:${address.ip.value}-255.255.255.255`);
  if (userLines.length > 0) {
    lines.push('## Allow all KoBox users', ...userLines);
  }

  const trackerLines = trackers
    .filter((tracker) => tracker.isActive)
    .sort(byHost)
    .flatMap((tracker) =>
      [...tracker.ipv4]
        .sort((a, b) => ipSortKey(a.value) - ipSortKey(b.value))
        .map((ip) => `${tracker.host.value}:${ip.value}-255.255.255.255`),
    );
  if (trackerLines.length > 0) {
    lines.push('## Trackers enabled', ...trackerLines);
  }

  return { path: '/etc/pgl/allow.p2p', content: `${lines.join('\n')}\n`, ...ROOT_FILE };
}

export function renderUserBlocklistDropin(username: Username, enabled: boolean): RenderedFile {
  const home = `/home/${username.value}`;
  const listPath = `${home}/blocklist/blocklist_rtorrent.txt`;
  const body = enabled
    ? [
        `ipv4_filter.load = ${listPath}, unwanted`,
        `schedule2 = load_filter,0,24:00:00,"ipv4_filter.load = ${listPath}, unwanted"`,
        'print = "IPv4 filter list size data:",(to_kb,(ipv4_filter.size_data))," kb."',
      ]
    : ['# No blocklist enabled — this drop-in is intentionally inert.'];
  return {
    path: `${home}/rtorrent/config.d/80-blocklist.rc`,
    content: [
      `# KoBox-managed file for ${username.value} — DO NOT EDIT.`,
      ...body,
      '',
    ].join('\n'),
    mode: '0640',
    owner: 'root',
    group: username.value,
  };
}

// The legacy shell pipeline (del_spaces / not_numeric / dot / sort -g / uniq)
// as one pure function over the downloaded range lines.
export function mergeBlocklistRanges(
  lists: readonly (readonly string[])[],
): readonly string[] {
  const kept = lists
    .flat()
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.includes(' '))
    .filter((line) => /^[0-9]/.test(line))
    .filter((line) => line.includes('.'));
  const unique = [...new Set(kept)];
  return unique.sort((a, b) => {
    const aKey = ipSortKey(a.split(/[-/]/, 1)[0] ?? '');
    const bKey = ipSortKey(b.split(/[-/]/, 1)[0] ?? '');
    return aKey - bKey || a.localeCompare(b);
  });
}

export function renderUserBlocklistFile(
  username: Username,
  ranges: readonly string[],
): RenderedFile {
  return {
    path: `/home/${username.value}/blocklist/blocklist_rtorrent.txt`,
    content: `${ranges.join('\n')}\n`,
    mode: '0640',
    owner: 'root',
    group: username.value,
  };
}
