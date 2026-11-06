import { describe, expect, it } from 'vitest';
import { parseJob, type Job } from '../../../../src/application/jobs/contract.js';
import {
  followUpsOf,
  type CompletedJob,
  type FollowUp,
} from '../../../../src/application/jobs/FollowUps.js';

function queueAnother(job: Job): FollowUp {
  return { job, ifAlreadyPending: 'queue-another' };
}

// a burst of causes runs it once
function join(job: Job): FollowUp {
  return { job, ifAlreadyPending: 'join' };
}

const alice = { username: 'alice' };
const films = { username: 'alice', label: 'Films' };
const address = { username: 'alice', ipv4: '198.51.100.7' };
const hostname = { username: 'alice', hostname: 'dyn.example.org' };
const whitelist = queueAnother(parseJob('render-whitelist', {}));
const firewall = queueAnother(parseJob('apply-firewall', {}));
const fail2ban = queueAnother(parseJob('render-fail2ban', {}));
const nfsExports = queueAnother(parseJob('render-nfs-exports', {}));
const sendAlicesTransfers = join(parseJob('send-pending-transfers', alice));
const renderAlicesConfig = join(parseJob('render-rtorrent-config', alice));
const nothingDirty = { whitelistDirty: false, firewallDirty: false, fail2banDirty: false };
const allDirty = { whitelistDirty: true, firewallDirty: true, fail2banDirty: true };

const cases: readonly (readonly [string, CompletedJob, readonly FollowUp[]])[] = [
  [
    'a member created: ports, then their rTorrent, VPN and NFS home',
    {
      type: 'create-user',
      payload: {
        username: 'alice',
        email: 'alice@example.org',
        quotaBytes: 1024,
        proxyPort: 8080,
        role: 'user',
      },
    },
    [
      join(parseJob('reserve-member-ports', {})),
      queueAnother(parseJob('provision-rtorrent', alice)),
      queueAnother(parseJob('provision-vpn-user', alice)),
      nfsExports,
    ],
  ],
  [
    'a member deleted: ports, then their rTorrent, VPN and NFS home go',
    { type: 'delete-user', payload: alice },
    [
      join(parseJob('reserve-member-ports', {})),
      queueAnother(parseJob('deprovision-rtorrent', alice)),
      queueAnother(parseJob('deprovision-vpn-user', alice)),
      nfsExports,
    ],
  ],
  [
    'an rTorrent provisioned: its filter, the firewall, the RPC mounts',
    { type: 'provision-rtorrent', payload: alice },
    [
      queueAnother(parseJob('render-blocklist-filters', alice)),
      firewall,
      queueAnother(parseJob('render-rutorrent-users', {})),
    ],
  ],
  [
    'an rTorrent deprovisioned: the firewall and the RPC mounts',
    { type: 'deprovision-rtorrent', payload: alice },
    [firewall, queueAnother(parseJob('render-rutorrent-users', {}))],
  ],
  [
    'a torrent event outside a straight-away folder: the media listing only',
    {
      type: 'torrent-event',
      payload: { username: 'alice', event: 'inserted_new', infoHash: 'a'.repeat(40) },
      report: undefined,
    },
    [join(parseJob('index-media', {}))],
  ],
  [
    'a download finished in a scheduled folder: the media listing only',
    {
      type: 'torrent-event',
      payload: { username: 'alice', event: 'finished', infoHash: 'a'.repeat(40), label: 'Films' },
      report: { queued: true, sendNow: false },
    },
    [join(parseJob('index-media', {}))],
  ],
  [
    'a download finished in a straight-away folder: the listing, then the send',
    {
      type: 'torrent-event',
      payload: { username: 'alice', event: 'finished', infoHash: 'a'.repeat(40), label: 'Films' },
      report: { queued: true, sendNow: true },
    },
    [join(parseJob('index-media', {})), sendAlicesTransfers],
  ],
  [
    'a straight-away folder backlog queued: sent at once',
    { type: 'queue-folder-backlog', payload: films, report: { queued: 2, sendNow: true } },
    [sendAlicesTransfers],
  ],
  [
    'a scheduled folder backlog queued: left to the member hour',
    { type: 'queue-folder-backlog', payload: films, report: { queued: 2, sendNow: false } },
    [],
  ],
  [
    'a transfer put back in a straight-away folder: sent at once',
    { type: 'requeue-transfer', payload: { username: 'alice', id: 7 }, report: 'straight-away' },
    [sendAlicesTransfers],
  ],
  [
    'a transfer put back in a scheduled folder: left to the member hour',
    { type: 'requeue-transfer', payload: { username: 'alice', id: 7 }, report: 'at-send-hour' },
    [],
  ],
  [
    'a transfer that was not put back: nothing',
    { type: 'requeue-transfer', payload: { username: 'alice', id: 7 }, report: 'not-requeued' },
    [],
  ],
  [
    'a folder switched to straight away: what waits there is sent at once',
    {
      type: 'set-category-sync-mode',
      payload: { ...films, mode: 'immediate' },
      report: 'straight-away',
    },
    [sendAlicesTransfers],
  ],
  [
    'a folder switched to a bit later: left to the member hour',
    {
      type: 'set-category-sync-mode',
      payload: { ...films, mode: 'scheduled' },
      report: 'at-send-hour',
    },
    [],
  ],
  [
    'a working check that put back a straight-away transfer: sent at once',
    {
      type: 'check-sync-destination',
      payload: { username: 'alice', trust: 'keep-recorded' },
      report: { sendNow: true },
    },
    [sendAlicesTransfers],
  ],
  [
    'a check that put back nothing to send now: left to the member hour',
    {
      type: 'check-sync-destination',
      payload: { username: 'alice', trust: 'accept-presented' },
      report: { sendNow: false },
    },
    [],
  ],
  [
    'a folder added: the member config rendered',
    { type: 'add-watch-dir', payload: films, report: { added: true } },
    [renderAlicesConfig],
  ],
  [
    'a folder already there: nothing',
    { type: 'add-watch-dir', payload: films, report: { added: false } },
    [],
  ],
  [
    'a folder removed: the member config rendered',
    { type: 'remove-watch-dir', payload: films, report: { changed: true } },
    [renderAlicesConfig],
  ],
  [
    'a folder that could not go: nothing',
    { type: 'remove-watch-dir', payload: films, report: { changed: false } },
    [],
  ],
  [
    'a folder renamed: the member config rendered',
    {
      type: 'rename-watch-dir',
      payload: { ...films, to: 'Docs' },
      report: { changed: true },
    },
    [renderAlicesConfig],
  ],
  [
    'a folder renamed already: nothing',
    {
      type: 'rename-watch-dir',
      payload: { ...films, to: 'Docs' },
      report: { changed: false },
    },
    [],
  ],
  [
    'an SSL tracker discovered: its cert fetched, then the whitelist',
    {
      type: 'discover-tracker',
      payload: { url: 'https://tracker.example.org/announce', privacy: 'private' },
      report: { host: 'tracker.example.org', certCheckWanted: true, whitelistDirty: true },
    },
    [queueAnother(parseJob('fetch-tracker-cert', { host: 'tracker.example.org' })), whitelist],
  ],
  [
    'a cert check wanted without a host: no fetch',
    {
      type: 'discover-tracker',
      payload: { url: 'https://tracker.example.org/announce', privacy: 'private' },
      report: { certCheckWanted: true, whitelistDirty: false },
    },
    [],
  ],
  [
    'a known tracker discovered again: nothing',
    {
      type: 'discover-tracker',
      payload: { url: 'https://tracker.example.org/announce', privacy: 'private' },
      report: { host: 'tracker.example.org', certCheckWanted: false, whitelistDirty: false },
    },
    [],
  ],
  [
    'a cert that promoted its tracker: the whitelist',
    {
      type: 'fetch-tracker-cert',
      payload: { host: 'tracker.example.org' },
      report: { promoted: true, whitelistDirty: true },
    },
    [whitelist],
  ],
  [
    'a cert check that changed nothing: nothing',
    {
      type: 'fetch-tracker-cert',
      payload: { host: 'tracker.example.org' },
      report: { promoted: false, whitelistDirty: false },
    },
    [],
  ],
  [
    'a renewal that promoted a tracker: the whitelist',
    {
      type: 'renew-tracker-certs',
      payload: { today: '2026-12-01' },
      report: { checked: 2, promoted: 1, failed: 0 },
    },
    [whitelist],
  ],
  [
    'a renewal that promoted nothing: nothing',
    {
      type: 'renew-tracker-certs',
      payload: { today: '2026-12-01' },
      report: { checked: 2, promoted: 0, failed: 1 },
    },
    [],
  ],
  [
    'a tracker marked dead: the whitelist',
    {
      type: 'mark-tracker-dead',
      payload: { host: 'tracker.example.org' },
      report: { whitelistDirty: true },
    },
    [whitelist],
  ],
  [
    'a tracker dead already: nothing',
    {
      type: 'mark-tracker-dead',
      payload: { host: 'tracker.example.org' },
      report: { whitelistDirty: false },
    },
    [],
  ],
  [
    'the catalog imported: the lists downloaded',
    { type: 'import-blocklist-catalog', payload: {} },
    [queueAnother(parseJob('update-blocklists', {}))],
  ],
  [
    'fresh ranges downloaded: every filter, then the kernel set',
    {
      type: 'update-blocklists',
      payload: {},
      report: { updated: 1, failures: [], skipped: 0, ranges: ['192.0.2.0/24'] },
    },
    [
      queueAnother(parseJob('render-blocklist-filters', {})),
      queueAnother(parseJob('apply-ipset', {})),
    ],
  ],
  [
    'every download failed: nothing',
    { type: 'update-blocklists', payload: {}, report: { updated: 0, failures: [], skipped: 0 } },
    [],
  ],
  [
    'a member address added: the four places it lives',
    { type: 'add-user-address', payload: address, report: { whitelistDirty: true } },
    [whitelist, firewall, fail2ban, nfsExports],
  ],
  [
    'a member address removed: the four places it lives',
    { type: 'remove-user-address', payload: address, report: { whitelistDirty: true } },
    [whitelist, firewall, fail2ban, nfsExports],
  ],
  [
    'a member address that changed no rendering: the NFS exports still',
    { type: 'add-user-address', payload: address, report: { whitelistDirty: false } },
    [nfsExports],
  ],
  [
    'a hostname added, not resolved yet: nothing',
    { type: 'add-user-hostname', payload: hostname, report: nothingDirty },
    [],
  ],
  [
    'a resolved hostname removed: whitelist, firewall, fail2ban',
    { type: 'remove-user-hostname', payload: hostname, report: allDirty },
    [whitelist, firewall, fail2ban],
  ],
  [
    'a dyndns address moved: whitelist, firewall, fail2ban',
    {
      type: 'resolve-dyndns',
      payload: {},
      report: { changed: 1, unresolved: 0, ...allDirty },
    },
    [whitelist, firewall, fail2ban],
  ],
  [
    'a dyndns pass that moved only the firewall: the firewall',
    {
      type: 'resolve-dyndns',
      payload: {},
      report: { changed: 1, unresolved: 0, ...nothingDirty, firewallDirty: true },
    },
    [firewall],
  ],
  [
    'a member VPN material issued: openvpn rendered',
    { type: 'provision-vpn-user', payload: alice, report: { openVpnDirty: true } },
    [queueAnother(parseJob('render-openvpn', {}))],
  ],
  [
    'a member VPN material removed: openvpn rendered',
    { type: 'deprovision-vpn-user', payload: alice, report: { openVpnDirty: true } },
    [queueAnother(parseJob('render-openvpn', {}))],
  ],
  [
    'a VPN change that dirtied nothing: nothing',
    { type: 'provision-vpn-user', payload: alice, report: { openVpnDirty: false } },
    [],
  ],
  [
    'a blocklist toggled: nothing, it renders its own filters',
    {
      type: 'set-blocklist-enabled',
      payload: { source: 'personal', author: 'me', name: 'mine', enabled: false },
    },
    [],
  ],
  ['the firewall applied: nothing', { type: 'apply-firewall', payload: {} }, []],
];

describe('what follows a job', () => {
  it.each(cases)('%s', (_situation, completed, expected) => {
    expect(followUpsOf(completed)).toEqual(expected);
  });
});
