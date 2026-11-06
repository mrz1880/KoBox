import type { HostnameDirtyReport } from '../security/ManageUserHostname.js';
import type { VpnUserReport } from '../security/ProvisionVpnUser.js';
import type { ResolveDynDnsReport } from '../security/ResolveDynDns.js';
import type { Departure } from '../../domain/sync/Departure.js';
import type { CheckReport } from '../sync/CheckSyncDestination.js';
import type { QueueVerdict } from '../sync/QueueFinishedDownload.js';
import type { QueueFolderBacklogReport } from '../sync/QueueFolderBacklog.js';
import type { RequeueOutcome } from '../sync/RequeueTransfer.js';
import type { AddWatchDirReport } from '../torrent/AddWatchDir.js';
import type { ReshapeWatchDirReport } from '../torrent/ReshapeWatchDir.js';
import type { DiscoveryReport } from '../tracker/DiscoverTrackerFromTorrent.js';
import type { CertCheckReport } from '../tracker/FetchTrackerCert.js';
import type { UserAddressReport } from '../tracker/ManageUserAddress.js';
import type { MarkDeadReport } from '../tracker/MarkTrackerDead.js';
import type { RenewalReport } from '../tracker/RenewTrackerCerts.js';
import type { BlocklistUpdateReport } from '../tracker/UpdateBlocklists.js';
import { parseJob, type Job, type JobType } from './contract.js';

// What a job's use case reported, for the jobs whose follow-ups depend on it.
// Every other job is followed by the same jobs whatever it found.
interface JobReports {
  readonly 'add-watch-dir': AddWatchDirReport;
  readonly 'remove-watch-dir': ReshapeWatchDirReport;
  readonly 'rename-watch-dir': ReshapeWatchDirReport;
  readonly 'queue-folder-backlog': QueueFolderBacklogReport;
  readonly 'requeue-transfer': RequeueOutcome;
  readonly 'check-sync-destination': CheckReport;
  // when what already waits in the folder leaves under its new mode
  readonly 'set-category-sync-mode': Departure;
  // the verdict on a finished download in a folder; none for any other event
  readonly 'torrent-event': QueueVerdict | undefined;
  readonly 'discover-tracker': DiscoveryReport;
  readonly 'fetch-tracker-cert': CertCheckReport;
  readonly 'renew-tracker-certs': RenewalReport;
  readonly 'mark-tracker-dead': MarkDeadReport;
  readonly 'update-blocklists': BlocklistUpdateReport;
  readonly 'add-user-address': UserAddressReport;
  readonly 'remove-user-address': UserAddressReport;
  readonly 'add-user-hostname': HostnameDirtyReport;
  readonly 'remove-user-hostname': HostnameDirtyReport;
  readonly 'resolve-dyndns': ResolveDynDnsReport;
  readonly 'provision-vpn-user': VpnUserReport;
  readonly 'deprovision-vpn-user': VpnUserReport;
}

type JobOf<T extends JobType> = Extract<Job, { readonly type: T }>;

type Completed<T extends JobType> = T extends keyof JobReports
  ? JobOf<T> & { readonly report: JobReports[T] }
  : JobOf<T>;

// A job its use case ran to the end, with what it reported when what follows
// depends on it: a job type listed in JobReports does not compile without it.
export type CompletedJob = { [T in JobType]: Completed<T> }[JobType];

// A follow-up that joins the same job already waiting runs once for a burst of
// causes; one that queues another runs once per cause.
export interface FollowUp {
  readonly job: Job;
  readonly ifAlreadyPending: 'join' | 'queue-another';
}

function queueAnother(job: Job): FollowUp {
  return { job, ifAlreadyPending: 'queue-another' };
}

function join(job: Job): FollowUp {
  return { job, ifAlreadyPending: 'join' };
}

function onlyIf(condition: boolean, ...followUps: readonly FollowUp[]): readonly FollowUp[] {
  return condition ? followUps : [];
}

const NOTHING: readonly FollowUp[] = [];

// Several downloads finishing at once must not stack several passes over the
// same member's queue: the send joins one already waiting.
function sendTransfersOf(username: string): FollowUp {
  return join(parseJob('send-pending-transfers', { username }));
}

// The folders queued behind this one join the same render, so a burst of them
// restarts rTorrent once.
function renderConfigOf(username: string): FollowUp {
  return join(parseJob('render-rtorrent-config', { username }));
}

// The renders a report found stale, always in this order: the tracker
// whitelist, the firewall, fail2ban.
function staleRenders(dirty: {
  readonly whitelist: boolean;
  readonly firewall: boolean;
  readonly fail2ban: boolean;
}): readonly FollowUp[] {
  return [
    ...onlyIf(dirty.whitelist, queueAnother(parseJob('render-whitelist', {}))),
    ...onlyIf(dirty.firewall, queueAnother(parseJob('apply-firewall', {}))),
    ...onlyIf(dirty.fail2ban, queueAnother(parseJob('render-fail2ban', {}))),
  ];
}

function addressRenders(report: HostnameDirtyReport): readonly FollowUp[] {
  return staleRenders({
    whitelist: report.whitelistDirty,
    firewall: report.firewallDirty,
    fail2ban: report.fail2banDirty,
  });
}

/**
 * What follows a member's account once it exists, whoever created it (the
 * create-user job, or the MySB import): the ledger just gained their ports,
 * which the kernel must keep before their rtorrent first binds them, then
 * their rtorrent, their VPN client certificate (Phase 3 debt #2 rides the
 * same seam) and the NFS exports, since a home appears with the account.
 *
 * @param username the member whose account was just created
 * @returns the follow-ups, in the order they are to be queued
 * @throws ZodError when the username is one the job contract refuses
 */
export function followUpsOfNewMember(username: string): readonly FollowUp[] {
  return [
    join(parseJob('reserve-member-ports', {})),
    queueAnother(parseJob('provision-rtorrent', { username })),
    queueAnother(parseJob('provision-vpn-user', { username })),
    queueAnother(parseJob('render-nfs-exports', {})),
  ];
}

/**
 * What follows a job its use case ran to the end: the jobs that carry its
 * consequences into the other contexts (a member's account into their rTorrent,
 * a tracker into the whitelist, a list into the kernel set). Pure: the caller
 * queues them, or runs them on the spot.
 *
 * @param completed the job, with what its use case reported when that decides
 * @returns the follow-ups, in the order they are to be queued
 * @throws ZodError when a report names a value the job contract refuses
 */
export function followUpsOf(completed: CompletedJob): readonly FollowUp[] {
  switch (completed.type) {
    case 'create-user':
      return followUpsOfNewMember(completed.payload.username);
    // the ledger just lost a member's ports: the kernel must keep exactly the
    // others; their home leaves with the account, so NFS exports follow
    case 'delete-user':
      return [
        join(parseJob('reserve-member-ports', {})),
        queueAnother(parseJob('deprovision-rtorrent', { username: completed.payload.username })),
        queueAnother(parseJob('deprovision-vpn-user', { username: completed.payload.username })),
        queueAnother(parseJob('render-nfs-exports', {})),
      ];
    // legacy parity: a fresh instance gets its blocklist filter immediately,
    // not at the next update-blocklists run; the firewall names uids and
    // rtorrent ports, and nginx the per-user /RPC-<USER> SCGI mounts, so both
    // follow whenever the provisioned population changes
    case 'provision-rtorrent':
      return [
        queueAnother(
          parseJob('render-blocklist-filters', { username: completed.payload.username }),
        ),
        queueAnother(parseJob('apply-firewall', {})),
        queueAnother(parseJob('render-rutorrent-users', {})),
      ];
    case 'deprovision-rtorrent':
      return [
        queueAnother(parseJob('apply-firewall', {})),
        queueAnother(parseJob('render-rutorrent-users', {})),
      ];
    // what landed on disk just changed: refresh the media listing; a download
    // finished in a folder that sends straight away leaves at once
    case 'torrent-event':
      return [
        join(parseJob('index-media', {})),
        ...onlyIf(
          completed.report?.sendNow === true,
          sendTransfersOf(completed.payload.username),
        ),
      ];
    case 'queue-folder-backlog':
      return onlyIf(completed.report.sendNow, sendTransfersOf(completed.payload.username));
    case 'requeue-transfer':
      return onlyIf(
        completed.report === 'straight-away',
        sendTransfersOf(completed.payload.username),
      );
    // what waited for the hour in a folder now sending straight away leaves now
    case 'set-category-sync-mode':
      return onlyIf(
        completed.report === 'straight-away',
        sendTransfersOf(completed.payload.username),
      );
    // a working check put back what failed for want of it
    case 'check-sync-destination':
      return onlyIf(completed.report.sendNow, sendTransfersOf(completed.payload.username));
    case 'add-watch-dir':
      return onlyIf(completed.report.added, renderConfigOf(completed.payload.username));
    case 'remove-watch-dir':
    case 'rename-watch-dir':
      return onlyIf(completed.report.changed, renderConfigOf(completed.payload.username));
    case 'discover-tracker': {
      const { host, certCheckWanted, whitelistDirty } = completed.report;
      return [
        ...(certCheckWanted && host !== undefined
          ? [queueAnother(parseJob('fetch-tracker-cert', { host }))]
          : NOTHING),
        ...staleRenders({ whitelist: whitelistDirty, firewall: false, fail2ban: false }),
      ];
    }
    case 'fetch-tracker-cert':
    case 'mark-tracker-dead':
      return staleRenders({
        whitelist: completed.report.whitelistDirty,
        firewall: false,
        fail2ban: false,
      });
    case 'renew-tracker-certs':
      return staleRenders({
        whitelist: completed.report.promoted > 0,
        firewall: false,
        fail2ban: false,
      });
    // the import enables lists; without a download right after, the kernel
    // set stays empty until the next scheduled update, hours later
    case 'import-blocklist-catalog':
      return [queueAnother(parseJob('update-blocklists', {}))];
    // fresh merged ranges reach every filter and the kernel set (pgl
    // successor); none at all means every download failed and the previous
    // cache stays authoritative
    case 'update-blocklists':
      return onlyIf(
        completed.report.ranges !== undefined,
        queueAnother(parseJob('render-blocklist-filters', {})),
        queueAnother(parseJob('apply-ipset', {})),
      );
    // a member address is rendered in four places: the whitelist, the
    // firewall trusted rules, fail2ban ignoreip and the NFS home exports
    case 'add-user-address':
    case 'remove-user-address': {
      const dirty = completed.report.whitelistDirty;
      return [
        ...staleRenders({ whitelist: dirty, firewall: dirty, fail2ban: dirty }),
        queueAnother(parseJob('render-nfs-exports', {})),
      ];
    }
    case 'add-user-hostname':
    case 'remove-user-hostname':
    case 'resolve-dyndns':
      return addressRenders(completed.report);
    case 'provision-vpn-user':
    case 'deprovision-vpn-user':
      return onlyIf(completed.report.openVpnDirty, queueAnother(parseJob('render-openvpn', {})));
    case 'change-password':
    case 'set-user-quota':
    case 'set-user-role':
    case 'sample-disk-usage':
    case 'apply-mail-relay':
    case 'set-ssh-key':
    case 'remove-ssh-key':
    case 'suspend-user':
    case 'resume-user':
    case 'restart-rtorrent':
    case 'render-rtorrent-config':
    case 'send-pending-transfers':
    case 'set-sync-disabled':
    case 'set-allow-public-tracker':
    case 'set-recycling':
    case 'render-whitelist':
    case 'render-blocklist-filters':
    // the toggle re-renders the filters itself, in the same job
    case 'set-blocklist-enabled':
    case 'apply-firewall':
    case 'render-fail2ban':
    case 'render-openvpn':
    case 'evaluate-fair-use':
    case 'set-fair-use-override':
    case 'send-mails':
    case 'index-media':
    case 'restart-service':
    case 'capture-service-log':
    case 'check-package-updates':
    case 'apply-package-updates':
    case 'run-speedtest':
    case 'run-backup':
    case 'apply-ipset':
    case 'render-rutorrent-users':
    case 'render-nfs-exports':
    case 'reserve-member-ports':
    case 'clean-up-space':
    case 'set-automatic-cleanup':
    case 'set-seed-rule':
    case 'set-own-seed-rule':
      return NOTHING;
  }
  // every job type is listed above: one added to the contract does not compile
  // until somebody decides what follows it
  const unlisted: never = completed;
  throw new Error(`no follow-up rule for job ${JSON.stringify(unlisted)}`);
}
