import { parseJob, type Job } from '../../application/jobs/contract.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import type { MailOutboxPort } from '../../application/maintenance/MailOutboxPort.js';
import { LoggableService, ManagedService } from '../../domain/maintenance/ManagedService.js';
import { parseRole } from '../../domain/portal/Role.js';
import { DynDnsHost } from '../../domain/security/DynDnsHost.js';
import { IpAddress } from '../../domain/shared/IpAddress.js';
import { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import { EventHook } from '../../domain/torrent/EventHook.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { Label } from '../../domain/torrent/Label.js';
import { SyncMode } from '../../domain/torrent/SyncMode.js';
import { AccountType } from '../../domain/user/AccountType.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { HashedPassword } from '../../domain/user/HashedPassword.js';
import { ProxyPort } from '../../domain/user/Port.js';
import { RecyclingMode } from '../../domain/torrent/RecyclingMode.js';
import { BlocklistSource } from '../../domain/tracker/BlocklistSource.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import type {
  DdlUseCases,
  MaintenanceUseCases,
  SecurityUseCases,
  SyncUseCases,
  TorrentUseCases,
  TrackerUseCases,
  UseCases,
} from '../useCases.js';

// What a completed job asks the worker to enqueue next. Use cases stay
// queue-agnostic: they return reports, the worker turns them into jobs.
interface ChainHints {
  readonly fetchCertHost?: string;
  readonly whitelistDirty?: boolean;
  readonly blocklistsUpdated?: boolean;
  readonly firewallDirty?: boolean;
  readonly fail2banDirty?: boolean;
  readonly openVpnDirty?: boolean;
  readonly nfsDirty?: boolean;
  // a member asked this folder to go out straight away rather than at their hour
  readonly sendNowFor?: string;
}

function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// The only privileged consumer. Payloads were schema-checked at enqueue and at
// claim; reconstructing Value Objects here is the final, authoritative gate.
export class JobWorker {
  constructor(
    private readonly queue: JobQueuePort,
    private readonly useCases: UseCases,
    private readonly torrents: TorrentUseCases,
    private readonly trackers: TrackerUseCases,
    private readonly security: SecurityUseCases,
    private readonly maintenance: MaintenanceUseCases,
    private readonly outbox: MailOutboxPort,
    private readonly ddl: DdlUseCases,
    private readonly sync: SyncUseCases,
  ) {}

  async processNext(): Promise<boolean> {
    const claimed = await this.queue.claimNextPending();
    if (!claimed) {
      return false;
    }
    let hints: ChainHints | undefined;
    try {
      hints = await this.execute(claimed.job);
      await this.queue.markDone(claimed.id);
    } catch (error) {
      await this.queue.markFailed(
        claimed.id,
        error instanceof Error ? error.message : String(error),
      );
      return true;
    }
    // Chaining runs only after the job is durably marked done, and outside the
    // try above: a failure to enqueue the follow-up must not re-fail a job
    // whose real work already succeeded.
    await this.chainAfter(claimed.job, hints);
    return true;
  }

  async drain(): Promise<number> {
    let count = 0;
    while (await this.processNext()) {
      count += 1;
    }
    return count;
  }

  // Cross-context coupling lives HERE, as chained jobs: User Management ->
  // Torrent Lifecycle, and Torrent/Tracker reports -> cert/whitelist/filters.
  private async chainAfter(job: Job, hints: ChainHints | undefined): Promise<void> {
    if (job.type === 'create-user') {
      await this.queue.enqueue(parseJob('provision-rtorrent', { username: job.payload.username }));
      // Phase 3 debt #2: client cert issuance rides the same seam
      await this.queue.enqueue(parseJob('provision-vpn-user', { username: job.payload.username }));
      // Nextcloud rides the same seam as rtorrent and the VPN. Leaving it to a
      // button meant a member without an account until somebody remembered; the
      // job itself does nothing when the component is not installed.
      await this.queue.enqueue(
        parseJob('provision-nextcloud-account', { username: job.payload.username }),
      );
      // welcome mail through the durable outbox — never a password in it
      await this.outbox.enqueue(
        {
          recipient: job.payload.email,
          subject: 'Your KoBox account is ready',
          body: [
            `Hello ${job.payload.username},`,
            '',
            'Your seedbox account has been created. Sign in to the portal with',
            'your username and the password you were given, then change it from',
            'the "Password" page.',
          ].join('\n'),
        },
        nowStamp(),
      );
    }
    if (job.type === 'delete-user') {
      await this.queue.enqueue(
        parseJob('deprovision-rtorrent', { username: job.payload.username }),
      );
      await this.queue.enqueue(
        parseJob('deprovision-vpn-user', { username: job.payload.username }),
      );
    }
    // a user's home appears/disappears with the account: re-render NFS exports
    if (job.type === 'delete-user') {
      // an account that outlives its member is a login nobody is watching
      await this.queue.enqueue(
        parseJob('delete-nextcloud-account', { username: job.payload.username }),
      );
    }
    if (job.type === 'create-user' || job.type === 'delete-user') {
      await this.queue.enqueue(parseJob('render-nfs-exports', {}));
    }
    // legacy parity: a fresh instance gets its blocklist filter immediately,
    // not at the next update-blocklists run
    if (job.type === 'provision-rtorrent') {
      await this.queue.enqueue(
        parseJob('render-blocklist-filters', { username: job.payload.username }),
      );
    }
    // the firewall names uids and rtorrent ports: reconcile it whenever the
    // provisioned population changes
    if (job.type === 'provision-rtorrent' || job.type === 'deprovision-rtorrent') {
      await this.queue.enqueue(parseJob('apply-firewall', {}));
      // and the per-user nginx /RPC-<USER> SCGI mounts (Phase 6)
      await this.queue.enqueue(parseJob('render-rutorrent-users', {}));
    }
    // what landed on disk just changed: refresh the media listing
    if (job.type === 'torrent-event' || job.type === 'poll-debrid-downloads') {
      await this.queue.enqueueUnique(parseJob('index-media', {}));
    }
    if (hints?.sendNowFor !== undefined) {
      // enqueueUnique: several downloads finishing at once must not stack
      // several passes over the same queue
      await this.queue.enqueueUnique(
        parseJob('send-pending-transfers', { username: hints.sendNowFor }),
      );
    }
    if (hints?.fetchCertHost !== undefined) {
      await this.queue.enqueue(parseJob('fetch-tracker-cert', { host: hints.fetchCertHost }));
    }
    if (hints?.whitelistDirty === true) {
      await this.queue.enqueue(parseJob('render-whitelist', {}));
    }
    if (hints?.blocklistsUpdated === true) {
      await this.queue.enqueue(parseJob('render-blocklist-filters', {}));
      // fresh merged ranges reach the kernel set too (pgl successor)
      await this.queue.enqueue(parseJob('apply-ipset', {}));
    }
    if (hints?.firewallDirty === true) {
      await this.queue.enqueue(parseJob('apply-firewall', {}));
    }
    if (hints?.fail2banDirty === true) {
      await this.queue.enqueue(parseJob('render-fail2ban', {}));
    }
    if (hints?.openVpnDirty === true) {
      await this.queue.enqueue(parseJob('render-openvpn', {}));
    }
    if (hints?.nfsDirty === true) {
      await this.queue.enqueue(parseJob('render-nfs-exports', {}));
    }
  }

  private async execute(job: Job): Promise<ChainHints | undefined> {
    switch (job.type) {
      case 'create-user':
        await this.useCases.createUser.execute({
          username: Username.parse(job.payload.username),
          email: EmailAddress.parse(job.payload.email),
          accountType: AccountType.parse(job.payload.accountType),
          quota: Quota.bytes(job.payload.quotaBytes),
          proxyPort: ProxyPort.parse(job.payload.proxyPort),
          passwordHash: HashedPassword.parse(job.payload.passwordHash),
          role: parseRole(job.payload.role),
        });
        return;
      case 'delete-user':
        await this.useCases.deleteUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'change-password':
        await this.useCases.changePassword.execute({
          username: Username.parse(job.payload.username),
          passwordHash: HashedPassword.parse(job.payload.passwordHash),
        });
        return;
      case 'set-user-quota':
        await this.useCases.setUserQuota.execute({
          username: Username.parse(job.payload.username),
          quota: Quota.gib(job.payload.quotaGib),
        });
        return;
      case 'apply-mail-relay':
        await this.maintenance.applyMailRelay.execute();
        return;
      case 'delete-nextcloud-account':
        await this.useCases.deleteNextcloudAccount.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'provision-nextcloud-account':
        await this.useCases.provisionNextcloudAccount.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'set-ssh-key':
        await this.useCases.setSshKey.execute({
          username: Username.parse(job.payload.username),
          key: job.payload.key,
        });
        return;
      case 'remove-ssh-key':
        await this.useCases.removeSshKey.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'sample-disk-usage':
        await this.useCases.sampleDiskUsage.execute();
        return;
      case 'suspend-user':
        await this.useCases.suspendUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'resume-user':
        await this.useCases.resumeUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'restart-rtorrent':
        await this.torrents.restart.execute({ username: Username.parse(job.payload.username) });
        return;
      case 'provision-rtorrent':
        await this.torrents.provision.execute({ username: Username.parse(job.payload.username) });
        return;
      case 'deprovision-rtorrent':
        await this.torrents.deprovision.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'render-rtorrent-config':
        await this.torrents.render.execute({ username: Username.parse(job.payload.username) });
        return;
      case 'add-watch-dir':
        await this.torrents.addWatchDir.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
        });
        return;
      case 'send-pending-transfers':
        await this.sync.sendPending.execute(
          job.payload.username === undefined
            ? undefined
            : Username.parse(job.payload.username),
        );
        return;
      case 'requeue-transfer':
        await this.sync.requeue.execute(Username.parse(job.payload.username), job.payload.id);
        return;
      case 'check-sync-destination':
        await this.sync.checkDestination.execute(Username.parse(job.payload.username));
        return;
      case 'set-category-sync-mode':
        await this.torrents.setCategorySyncMode.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
          mode: SyncMode.parse(job.payload.mode),
        });
        return;
      case 'set-sync-disabled':
        await this.torrents.setSyncDisabled.execute({
          username: Username.parse(job.payload.username),
          disabled: job.payload.disabled,
        });
        return;
      case 'set-recycling':
        await this.torrents.setRecycling.execute({
          username: Username.parse(job.payload.username),
          mode: RecyclingMode.parse(job.payload.mode),
        });
        return;
      case 'set-allow-public-tracker':
        await this.torrents.setAllowPublicTracker.execute({
          username: Username.parse(job.payload.username),
          allowed: job.payload.allowed,
        });
        return;
      case 'torrent-event':
        await this.torrents.handleEvent.execute({
          username: Username.parse(job.payload.username),
          event: EventHook.parse(job.payload.event).type,
          infoHash: InfoHash.parse(job.payload.infoHash),
          ...(job.payload.name !== undefined && { name: job.payload.name }),
          ...(job.payload.directory !== undefined && { directory: job.payload.directory }),
          ...(job.payload.basePath !== undefined && { basePath: job.payload.basePath }),
          ...(job.payload.torrentFile !== undefined && { torrentFile: job.payload.torrentFile }),
          ...(job.payload.label !== undefined && { label: Label.parse(job.payload.label) }),
          ...(job.payload.isPrivate !== undefined && { isPrivate: job.payload.isPrivate }),
        });
        // A finished download in a folder its owner asked to be sent goes into
        // the transfer queue. Only the label carries that decision, so an
        // unlabelled finish is nothing to do here.
        if (job.payload.event === 'finished' && job.payload.label !== undefined) {
          const verdict = await this.sync.queueFinished.execute({
            username: Username.parse(job.payload.username),
            label: Label.parse(job.payload.label),
            source: job.payload.basePath ?? job.payload.directory ?? '',
          });
          if (verdict.sendNow) {
            return { sendNowFor: job.payload.username };
          }
        }
        return;
      case 'discover-tracker': {
        const report = await this.trackers.discover.execute({
          url: job.payload.url,
          privacy: job.payload.privacy,
          today: nowStamp().slice(0, 10),
        });
        return {
          ...(report.certCheckWanted &&
            report.host !== undefined && { fetchCertHost: report.host }),
          whitelistDirty: report.whitelistDirty,
        };
      }
      case 'fetch-tracker-cert': {
        const report = await this.trackers.fetchCert.execute({
          host: TrackerHost.parse(job.payload.host),
          now: nowStamp(),
        });
        return { whitelistDirty: report.whitelistDirty };
      }
      case 'renew-tracker-certs': {
        const report = await this.trackers.renewCerts.execute({
          today: job.payload.today,
          now: nowStamp(),
        });
        return { whitelistDirty: report.promoted > 0 };
      }
      case 'mark-tracker-dead': {
        const report = await this.trackers.markDead.execute({
          host: TrackerHost.parse(job.payload.host),
        });
        return { whitelistDirty: report.whitelistDirty };
      }
      case 'import-blocklist-catalog':
        await this.trackers.importCatalog.execute();
        return;
      case 'update-blocklists': {
        const report = await this.trackers.updateBlocklists.execute({ now: nowStamp() });
        return { blocklistsUpdated: report.ranges !== undefined };
      }
      // the toggle is only half the job: without the re-render the filter file
      // keeps the old set until the next scheduled pass, which is exactly the
      // "disabling does nothing" the operator reported
      case 'set-blocklist-enabled':
        await this.trackers.setBlocklistEnabled.execute({
          source: BlocklistSource.parse(job.payload.source),
          author: job.payload.author,
          name: job.payload.name,
          enabled: job.payload.enabled,
        });
        // the merged cache is rebuilt from the per-list caches, then the
        // filter is re-rendered from it. Without the rebuild the disabled
        // list's ranges survive, which is the "disabling does nothing" the
        // operator reported.
        await this.trackers.rebuildBlocklistCache.execute();
        await this.trackers.renderBlocklistFilters.execute({});
        return;
      case 'render-whitelist':
        await this.trackers.renderWhitelist.execute();
        return;
      case 'render-blocklist-filters':
        await this.trackers.renderBlocklistFilters.execute({
          ...(job.payload.username !== undefined && {
            username: Username.parse(job.payload.username),
          }),
        });
        return;
      case 'apply-firewall':
        await this.security.applyFirewall.execute();
        return;
      case 'render-fail2ban':
        await this.security.renderFail2ban.execute();
        return;
      case 'add-user-hostname':
      case 'remove-user-hostname':
        return await this.security.manageUserHostname.execute({
          action: job.type === 'add-user-hostname' ? 'add' : 'remove',
          username: Username.parse(job.payload.username),
          host: DynDnsHost.parse(job.payload.hostname),
        });
      case 'resolve-dyndns': {
        const report = await this.security.resolveDynDns.execute();
        return {
          whitelistDirty: report.whitelistDirty,
          firewallDirty: report.firewallDirty,
          fail2banDirty: report.fail2banDirty,
        };
      }
      case 'render-openvpn':
        await this.security.renderOpenVpn.execute();
        return;
      case 'provision-vpn-user':
        return await this.security.provisionVpnUser.execute({
          username: Username.parse(job.payload.username),
        });
      case 'deprovision-vpn-user':
        return await this.security.deprovisionVpnUser.execute({
          username: Username.parse(job.payload.username),
        });
      case 'evaluate-fair-use':
        await this.security.evaluateFairUse.execute({ now: nowStamp() });
        return;
      case 'set-fair-use-override':
        await this.security.setFairUseOverride.execute({
          username: Username.parse(job.payload.username),
          ...(job.payload.egressLimitBps !== undefined && {
            egressLimitBps: job.payload.egressLimitBps,
          }),
          ...(job.payload.authRatePerHour !== undefined && {
            authRatePerHour: job.payload.authRatePerHour,
          }),
          ...(job.payload.throttleToBps !== undefined && {
            throttleToBps: job.payload.throttleToBps,
          }),
          now: nowStamp(),
        });
        return;
      case 'send-mails':
        await this.maintenance.sendMails.execute({ now: nowStamp() });
        return;
      case 'index-media':
        await this.torrents.indexMedia.execute();
        return;
      case 'restart-service':
        await this.maintenance.restartService.execute({
          service: ManagedService.parse(job.payload.service),
        });
        return;
      case 'capture-service-log':
        await this.maintenance.captureServiceLog.execute(
          LoggableService.parse(job.payload.service),
        );
        return;
      case 'check-package-updates':
        await this.maintenance.checkPackageUpdates.execute();
        return;
      case 'apply-package-updates':
        await this.maintenance.applyPackageUpdates.execute();
        return;
      case 'run-speedtest':
        await this.maintenance.runSpeedtest.execute();
        return;
      case 'run-backup':
        await this.maintenance.runBackup.execute({ now: nowStamp() });
        return;
      case 'apply-ipset':
        await this.trackers.applyIpset.execute();
        return;
      case 'render-rutorrent-users':
        await this.torrents.renderRutorrentUsers.execute();
        return;
      case 'render-nfs-exports':
        await this.security.renderNfsExports.execute();
        return;
      case 'debrid-download':
        await this.ddl.startDownload.execute({ downloadId: job.payload.downloadId });
        return;
      case 'poll-debrid-downloads':
        await this.ddl.pollDownloads.execute();
        return;
      case 'set-debrid-key':
        await this.ddl.storeDebridKey.execute({
          username: Username.parse(job.payload.username),
          encryptedKey: job.payload.encryptedKey,
        });
        return;
      case 'clear-debrid-key':
        await this.ddl.clearDebridKey.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'add-user-address':
      case 'remove-user-address': {
        const report = await this.trackers.manageUserAddress.execute({
          action: job.type === 'add-user-address' ? 'add' : 'remove',
          username: Username.parse(job.payload.username),
          ip: IpAddress.parse(job.payload.ipv4),
        });
        // a member address is rendered in four places: the whitelist, the
        // firewall trusted rules, fail2ban ignoreip and the NFS home exports
        return {
          whitelistDirty: report.whitelistDirty,
          firewallDirty: report.whitelistDirty,
          fail2banDirty: report.whitelistDirty,
          nfsDirty: true,
        };
      }
    }
  }
}
