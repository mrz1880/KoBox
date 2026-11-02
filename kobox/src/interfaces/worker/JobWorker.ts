import { messageOf } from '../../domain/shared/errorMessage.js';
import { parseJob, type Job } from '../../application/jobs/contract.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import { LoggableService, ManagedService } from '../../domain/maintenance/ManagedService.js';
import { parseRole } from '../../domain/portal/Role.js';
import { DynDnsHost } from '../../domain/security/DynDnsHost.js';
import { IpAddress } from '../../domain/shared/IpAddress.js';
import { stampOf } from '../../domain/shared/stamp.js';
import { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import { EventHook } from '../../domain/torrent/EventHook.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { parseAutomaticCleanup } from '../../domain/space/AutomaticCleanup.js';
import { SeedRule } from '../../domain/space/SeedRule.js';
import { Label } from '../../domain/torrent/Label.js';
import { SyncMode } from '../../domain/torrent/SyncMode.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { ProxyPort } from '../../domain/user/Port.js';
import { RecyclingMode } from '../../domain/torrent/RecyclingMode.js';
import { BlocklistSource } from '../../domain/tracker/BlocklistSource.js';
import { Quota } from '../../domain/user/Quota.js';
import type { PasswordOpenerPort } from '../../domain/user/ports.js';
import type { Logger } from '../../infrastructure/logging/logger.js';
import { diskUsagePassWarnings } from '../diskUsagePassWarnings.js';
import { Username } from '../../domain/user/Username.js';
import type {
  MaintenanceUseCases,
  SecurityUseCases,
  SpaceUseCases,
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
  readonly blocklistsDue?: boolean;
  readonly firewallDirty?: boolean;
  readonly fail2banDirty?: boolean;
  readonly openVpnDirty?: boolean;
  readonly nfsDirty?: boolean;
  // a member asked this folder to go out straight away rather than at their hour
  readonly sendNowFor?: string;
  // a member's rTorrent config changed: render it (and restart) once per burst
  readonly renderConfigFor?: string;
}

function nowStamp(): string {
  return stampOf(new Date());
}

export interface JobWorkerDeps {
  readonly queue: JobQueuePort;
  readonly useCases: UseCases;
  readonly torrents: TorrentUseCases;
  readonly trackers: TrackerUseCases;
  readonly security: SecurityUseCases;
  readonly maintenance: MaintenanceUseCases;
  readonly sync: SyncUseCases;
  readonly space: SpaceUseCases;
  // the private half of the host key: only the root worker can open a
  // password the portal sealed
  readonly passwords: PasswordOpenerPort;
  // told what a job could not do although the job itself succeeded
  readonly logger: Pick<Logger, 'warn'>;
}

// The only privileged consumer. Payloads were schema-checked at enqueue and at
// claim; reconstructing Value Objects here is the final, authoritative gate.
export class JobWorker {
  constructor(private readonly deps: JobWorkerDeps) {}

  async processNext(): Promise<boolean> {
    const claimed = await this.deps.queue.claimNextPending();
    if (!claimed) {
      return false;
    }
    let hints: ChainHints | undefined;
    try {
      hints = await this.execute(claimed.job);
      await this.deps.queue.markDone(claimed.id);
    } catch (error) {
      await this.deps.queue.markFailed(
        claimed.id,
        messageOf(error),
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
      await this.deps.queue.enqueue(
        parseJob('provision-rtorrent', { username: job.payload.username }),
      );
      // Phase 3 debt #2: client cert issuance rides the same seam
      await this.deps.queue.enqueue(
        parseJob('provision-vpn-user', { username: job.payload.username }),
      );
    }
    if (job.type === 'delete-user') {
      await this.deps.queue.enqueue(
        parseJob('deprovision-rtorrent', { username: job.payload.username }),
      );
      await this.deps.queue.enqueue(
        parseJob('deprovision-vpn-user', { username: job.payload.username }),
      );
    }
    // a user's home appears/disappears with the account: re-render NFS exports
    if (job.type === 'create-user' || job.type === 'delete-user') {
      await this.deps.queue.enqueue(parseJob('render-nfs-exports', {}));
    }
    // legacy parity: a fresh instance gets its blocklist filter immediately,
    // not at the next update-blocklists run
    if (job.type === 'provision-rtorrent') {
      await this.deps.queue.enqueue(
        parseJob('render-blocklist-filters', { username: job.payload.username }),
      );
    }
    // the firewall names uids and rtorrent ports: reconcile it whenever the
    // provisioned population changes
    if (job.type === 'provision-rtorrent' || job.type === 'deprovision-rtorrent') {
      await this.deps.queue.enqueue(parseJob('apply-firewall', {}));
      // and the per-user nginx /RPC-<USER> SCGI mounts (Phase 6)
      await this.deps.queue.enqueue(parseJob('render-rutorrent-users', {}));
    }
    // what landed on disk just changed: refresh the media listing
    if (job.type === 'torrent-event') {
      await this.deps.queue.enqueueUnique(parseJob('index-media', {}));
    }
    if (hints?.sendNowFor !== undefined) {
      // enqueueUnique: several downloads finishing at once must not stack
      // several passes over the same queue
      await this.deps.queue.enqueueUnique(
        parseJob('send-pending-transfers', { username: hints.sendNowFor }),
      );
    }
    if (hints?.fetchCertHost !== undefined) {
      await this.deps.queue.enqueue(parseJob('fetch-tracker-cert', { host: hints.fetchCertHost }));
    }
    if (hints?.whitelistDirty === true) {
      await this.deps.queue.enqueue(parseJob('render-whitelist', {}));
    }
    if (hints?.blocklistsDue === true) {
      await this.deps.queue.enqueue(parseJob('update-blocklists', {}));
    }
    if (hints?.blocklistsUpdated === true) {
      await this.deps.queue.enqueue(parseJob('render-blocklist-filters', {}));
      // fresh merged ranges reach the kernel set too (pgl successor)
      await this.deps.queue.enqueue(parseJob('apply-ipset', {}));
    }
    if (hints?.firewallDirty === true) {
      await this.deps.queue.enqueue(parseJob('apply-firewall', {}));
    }
    if (hints?.fail2banDirty === true) {
      await this.deps.queue.enqueue(parseJob('render-fail2ban', {}));
    }
    if (hints?.openVpnDirty === true) {
      await this.deps.queue.enqueue(parseJob('render-openvpn', {}));
    }
    if (hints?.nfsDirty === true) {
      await this.deps.queue.enqueue(parseJob('render-nfs-exports', {}));
    }
    // unique while pending: the folders queued behind this one join the same
    // render, so a burst of them restarts rTorrent once
    if (hints?.renderConfigFor !== undefined) {
      await this.deps.queue.enqueueUnique(
        parseJob('render-rtorrent-config', { username: hints.renderConfigFor }),
      );
    }
  }

  private async execute(job: Job): Promise<ChainHints | undefined> {
    switch (job.type) {
      case 'create-user':
        await this.deps.useCases.createUser.execute({
          username: Username.parse(job.payload.username),
          email: EmailAddress.parse(job.payload.email),
          quota: Quota.bytes(job.payload.quotaBytes),
          proxyPort: ProxyPort.parse(job.payload.proxyPort),
          ...(job.payload.sealedPassword !== undefined && {
            password: await this.deps.passwords.open(job.payload.sealedPassword),
          }),
          role: parseRole(job.payload.role),
        });
        return;
      case 'delete-user':
        await this.deps.useCases.deleteUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'change-password':
        await this.deps.useCases.changePassword.execute({
          username: Username.parse(job.payload.username),
          password: await this.deps.passwords.open(job.payload.sealedPassword),
        });
        return;
      case 'set-user-quota':
        await this.deps.useCases.setUserQuota.execute({
          username: Username.parse(job.payload.username),
          quota: Quota.gib(job.payload.quotaGib),
        });
        return;
      case 'set-user-role':
        await this.deps.useCases.changeRole.execute({
          username: Username.parse(job.payload.username),
          role: parseRole(job.payload.role),
        });
        return;
      case 'apply-mail-relay':
        await this.deps.maintenance.applyMailRelay.execute();
        return;
      case 'set-ssh-key':
        await this.deps.useCases.setSshKey.execute({
          username: Username.parse(job.payload.username),
          key: job.payload.key,
        });
        return;
      case 'remove-ssh-key':
        await this.deps.useCases.removeSshKey.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'sample-disk-usage': {
        const pass = await this.deps.useCases.sampleDiskUsage.execute();
        for (const warning of diskUsagePassWarnings(pass)) {
          this.deps.logger.warn(warning.context, warning.message);
        }
        return;
      }
      case 'suspend-user':
        await this.deps.useCases.suspendUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'resume-user':
        await this.deps.useCases.resumeUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'restart-rtorrent':
        await this.deps.torrents.restart.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'provision-rtorrent':
        await this.deps.torrents.provision.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'deprovision-rtorrent':
        await this.deps.torrents.deprovision.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'render-rtorrent-config':
        await this.deps.torrents.render.execute({ username: Username.parse(job.payload.username) });
        return;
      case 'add-watch-dir': {
        const { added } = await this.deps.torrents.addWatchDir.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
        });
        return added ? { renderConfigFor: job.payload.username } : undefined;
      }
      case 'remove-watch-dir': {
        const { changed } = await this.deps.torrents.removeWatchDir.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
        });
        return changed ? { renderConfigFor: job.payload.username } : undefined;
      }
      case 'rename-watch-dir': {
        const { changed } = await this.deps.torrents.renameWatchDir.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
          to: Label.parse(job.payload.to),
        });
        return changed ? { renderConfigFor: job.payload.username } : undefined;
      }
      case 'send-pending-transfers':
        await this.deps.sync.sendPending.execute(
          job.payload.username === undefined
            ? undefined
            : Username.parse(job.payload.username),
        );
        return;
      case 'queue-folder-backlog': {
        const report = await this.deps.sync.queueBacklog.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
        });
        return report.sendNow ? { sendNowFor: job.payload.username } : undefined;
      }
      case 'requeue-transfer':
        await this.deps.sync.requeue.execute(Username.parse(job.payload.username), job.payload.id);
        return;
      case 'check-sync-destination':
        await this.deps.sync.checkDestination.execute(Username.parse(job.payload.username));
        return;
      case 'set-category-sync-mode':
        await this.deps.torrents.setCategorySyncMode.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
          mode: SyncMode.parse(job.payload.mode),
        });
        return;
      case 'set-sync-disabled':
        await this.deps.torrents.setSyncDisabled.execute({
          username: Username.parse(job.payload.username),
          disabled: job.payload.disabled,
        });
        return;
      case 'set-recycling':
        await this.deps.torrents.setRecycling.execute({
          username: Username.parse(job.payload.username),
          mode: RecyclingMode.parse(job.payload.mode),
        });
        return;
      case 'set-allow-public-tracker':
        await this.deps.torrents.setAllowPublicTracker.execute({
          username: Username.parse(job.payload.username),
          allowed: job.payload.allowed,
        });
        return;
      case 'torrent-event':
        await this.deps.torrents.handleEvent.execute({
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
          const verdict = await this.deps.sync.queueFinished.execute({
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
        const report = await this.deps.trackers.discover.execute({
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
        const report = await this.deps.trackers.fetchCert.execute({
          host: TrackerHost.parse(job.payload.host),
          now: nowStamp(),
        });
        return { whitelistDirty: report.whitelistDirty };
      }
      case 'renew-tracker-certs': {
        const report = await this.deps.trackers.renewCerts.execute({
          today: job.payload.today,
          now: nowStamp(),
        });
        return { whitelistDirty: report.promoted > 0 };
      }
      case 'mark-tracker-dead': {
        const report = await this.deps.trackers.markDead.execute({
          host: TrackerHost.parse(job.payload.host),
        });
        return { whitelistDirty: report.whitelistDirty };
      }
      // the import enables lists; without a download right after, the kernel
      // set stays empty until the next scheduled update, hours later
      case 'import-blocklist-catalog':
        await this.deps.trackers.importCatalog.execute();
        return { blocklistsDue: true };
      case 'update-blocklists': {
        const report = await this.deps.trackers.updateBlocklists.execute({ now: nowStamp() });
        return { blocklistsUpdated: report.ranges !== undefined };
      }
      // the toggle is only half the job: without the re-render the filter file
      // keeps the old set until the next scheduled pass, which is exactly the
      // "disabling does nothing" the operator reported
      case 'set-blocklist-enabled':
        await this.deps.trackers.setBlocklistEnabled.execute({
          source: BlocklistSource.parse(job.payload.source),
          author: job.payload.author,
          name: job.payload.name,
          enabled: job.payload.enabled,
        });
        // the merged cache is rebuilt from the per-list caches, then the
        // filter is re-rendered from it. Without the rebuild the disabled
        // list's ranges survive, which is the "disabling does nothing" the
        // operator reported.
        await this.deps.trackers.rebuildBlocklistCache.execute();
        await this.deps.trackers.renderBlocklistFilters.execute({});
        return;
      case 'render-whitelist':
        await this.deps.trackers.renderWhitelist.execute();
        return;
      case 'render-blocklist-filters':
        await this.deps.trackers.renderBlocklistFilters.execute({
          ...(job.payload.username !== undefined && {
            username: Username.parse(job.payload.username),
          }),
        });
        return;
      case 'apply-firewall':
        await this.deps.security.applyFirewall.execute();
        return;
      case 'render-fail2ban':
        await this.deps.security.renderFail2ban.execute();
        return;
      case 'add-user-hostname':
      case 'remove-user-hostname':
        return await this.deps.security.manageUserHostname.execute({
          action: job.type === 'add-user-hostname' ? 'add' : 'remove',
          username: Username.parse(job.payload.username),
          host: DynDnsHost.parse(job.payload.hostname),
        });
      case 'resolve-dyndns': {
        const report = await this.deps.security.resolveDynDns.execute();
        return {
          whitelistDirty: report.whitelistDirty,
          firewallDirty: report.firewallDirty,
          fail2banDirty: report.fail2banDirty,
        };
      }
      case 'render-openvpn':
        await this.deps.security.renderOpenVpn.execute();
        return;
      case 'provision-vpn-user':
        return await this.deps.security.provisionVpnUser.execute({
          username: Username.parse(job.payload.username),
        });
      case 'deprovision-vpn-user':
        return await this.deps.security.deprovisionVpnUser.execute({
          username: Username.parse(job.payload.username),
        });
      case 'evaluate-fair-use':
        await this.deps.security.evaluateFairUse.execute({ now: nowStamp() });
        return;
      case 'set-fair-use-override':
        await this.deps.security.setFairUseOverride.execute({
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
        await this.deps.maintenance.sendMails.execute({ now: nowStamp() });
        return;
      case 'index-media':
        await this.deps.torrents.indexMedia.execute();
        return;
      case 'restart-service':
        await this.deps.maintenance.restartService.execute({
          service: ManagedService.parse(job.payload.service),
        });
        return;
      case 'capture-service-log':
        await this.deps.maintenance.captureServiceLog.execute(
          LoggableService.parse(job.payload.service),
        );
        return;
      case 'check-package-updates':
        await this.deps.maintenance.checkPackageUpdates.execute();
        return;
      case 'apply-package-updates':
        await this.deps.maintenance.applyPackageUpdates.execute();
        return;
      case 'run-speedtest':
        await this.deps.maintenance.runSpeedtest.execute();
        return;
      case 'run-backup':
        await this.deps.maintenance.runBackup.execute({ now: nowStamp() });
        return;
      case 'apply-ipset':
        await this.deps.trackers.applyIpset.execute();
        return;
      case 'render-rutorrent-users':
        await this.deps.torrents.renderRutorrentUsers.execute();
        return;
      case 'render-nfs-exports':
        await this.deps.security.renderNfsExports.execute();
        return;
      case 'clean-up-space': {
        const username = Username.parse(job.payload.username);
        const report = await this.deps.space.cleanUpSpace.execute({
          username,
          infoHashes: job.payload.infoHashes.map((raw) => InfoHash.parse(raw)),
          trigger: job.payload.trigger,
        });
        // the member reads the report on their page; the name, not the path,
        // keeps the log short and the member's tree out of it
        for (const failure of report.failures) {
          this.deps.logger.warn(
            { username: username.value, torrent: failure.name, reason: failure.reason },
            'space cleanup: torrent not removed',
          );
        }
        return;
      }
      case 'set-automatic-cleanup':
        await this.deps.space.setAutomaticCleanup.execute({
          username: Username.parse(job.payload.username),
          automatic: parseAutomaticCleanup(job.payload.scope),
        });
        return;
      case 'set-seed-rule':
        await this.deps.space.setSeedRule.execute(SeedRule.of(job.payload));
        return;
      case 'set-own-seed-rule': {
        const { rule } = job.payload;
        await this.deps.space.setOwnSeedRule.execute({
          username: Username.parse(job.payload.username),
          // a null ratio on the wire is a rule on days alone
          choice:
            rule === null
              ? { kind: 'box' }
              : {
                  kind: 'own',
                  rule: SeedRule.of({ ratio: rule.ratio ?? undefined, days: rule.days }),
                },
        });
        return;
      }
      case 'add-user-address':
      case 'remove-user-address': {
        const report = await this.deps.trackers.manageUserAddress.execute({
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
    // every case returns: a job type added to the contract without one does
    // not compile, rather than being marked done without anything run
    const unhandled: never = job;
    throw new Error(`no worker case for job ${JSON.stringify(unhandled)}`);
  }
}
