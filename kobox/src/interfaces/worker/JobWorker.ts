import { messageOf } from '../../domain/shared/errorMessage.js';
import type { Job } from '../../application/jobs/contract.js';
import { followUpsOf, type CompletedJob } from '../../application/jobs/FollowUps.js';
import { queueFollowUps } from '../../application/jobs/queueFollowUps.js';
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
import { immediatePassFor, SCHEDULED_PASS } from '../../domain/sync/SendPass.js';
import type {
  MaintenanceUseCases,
  SecurityUseCases,
  SpaceUseCases,
  SyncUseCases,
  TorrentUseCases,
  TrackerUseCases,
  UseCases,
} from '../useCases.js';

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
    let completed: CompletedJob;
    try {
      completed = await this.execute(claimed.job);
      await this.deps.queue.markDone(claimed.id);
    } catch (error) {
      await this.deps.queue.markFailed(
        claimed.id,
        messageOf(error),
      );
      return true;
    }
    // Follow-ups are queued only after the job is durably marked done, and
    // outside the try above: a failure to queue one must not re-fail a job
    // whose real work already succeeded.
    await queueFollowUps(this.deps.queue, followUpsOf(completed));
    return true;
  }

  async drain(): Promise<number> {
    let count = 0;
    while (await this.processNext()) {
      count += 1;
    }
    return count;
  }

  private async execute(job: Job): Promise<CompletedJob> {
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
        return job;
      case 'delete-user':
        await this.deps.useCases.deleteUser.execute({
          username: Username.parse(job.payload.username),
        });
        return job;
      case 'change-password':
        await this.deps.useCases.changePassword.execute({
          username: Username.parse(job.payload.username),
          password: await this.deps.passwords.open(job.payload.sealedPassword),
        });
        return job;
      case 'set-user-quota':
        await this.deps.useCases.setUserQuota.execute({
          username: Username.parse(job.payload.username),
          quota: Quota.gib(job.payload.quotaGib),
        });
        return job;
      case 'set-user-role':
        await this.deps.useCases.changeRole.execute({
          username: Username.parse(job.payload.username),
          role: parseRole(job.payload.role),
        });
        return job;
      case 'apply-mail-relay':
        await this.deps.maintenance.applyMailRelay.execute();
        return job;
      case 'set-ssh-key':
        await this.deps.useCases.setSshKey.execute({
          username: Username.parse(job.payload.username),
          key: job.payload.key,
        });
        return job;
      case 'remove-ssh-key':
        await this.deps.useCases.removeSshKey.execute({
          username: Username.parse(job.payload.username),
        });
        return job;
      case 'sample-disk-usage': {
        const pass = await this.deps.useCases.sampleDiskUsage.execute();
        for (const warning of diskUsagePassWarnings(pass)) {
          this.deps.logger.warn(warning.context, warning.message);
        }
        return job;
      }
      case 'suspend-user':
        await this.deps.useCases.suspendUser.execute({
          username: Username.parse(job.payload.username),
        });
        return job;
      case 'resume-user':
        await this.deps.useCases.resumeUser.execute({
          username: Username.parse(job.payload.username),
        });
        return job;
      case 'restart-rtorrent':
        await this.deps.torrents.restart.execute({
          username: Username.parse(job.payload.username),
        });
        return job;
      case 'provision-rtorrent':
        await this.deps.torrents.provision.execute({
          username: Username.parse(job.payload.username),
        });
        return job;
      case 'deprovision-rtorrent':
        await this.deps.torrents.deprovision.execute({
          username: Username.parse(job.payload.username),
        });
        return job;
      case 'render-rtorrent-config':
        await this.deps.torrents.render.execute({ username: Username.parse(job.payload.username) });
        return job;
      case 'add-watch-dir': {
        const report = await this.deps.torrents.addWatchDir.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
        });
        return { ...job, report };
      }
      case 'remove-watch-dir': {
        const report = await this.deps.torrents.removeWatchDir.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
        });
        return { ...job, report };
      }
      case 'rename-watch-dir': {
        const report = await this.deps.torrents.renameWatchDir.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
          to: Label.parse(job.payload.to),
        });
        return { ...job, report };
      }
      case 'send-pending-transfers':
        await this.deps.sync.sendPending.execute(
          job.payload.username === undefined
            ? SCHEDULED_PASS
            : immediatePassFor(Username.parse(job.payload.username)),
        );
        return job;
      case 'queue-folder-backlog': {
        const report = await this.deps.sync.queueBacklog.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
        });
        return { ...job, report };
      }
      case 'requeue-transfer': {
        const report = await this.deps.sync.requeue.execute(
          Username.parse(job.payload.username),
          job.payload.id,
        );
        return { ...job, report };
      }
      case 'check-sync-destination': {
        const report = await this.deps.sync.checkDestination.execute(
          Username.parse(job.payload.username),
          job.payload.trust,
        );
        return { ...job, report };
      }
      case 'set-category-sync-mode':
        await this.deps.torrents.setCategorySyncMode.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
          mode: SyncMode.parse(job.payload.mode),
        });
        return job;
      case 'set-sync-disabled':
        await this.deps.torrents.setSyncDisabled.execute({
          username: Username.parse(job.payload.username),
          disabled: job.payload.disabled,
        });
        return job;
      case 'set-recycling':
        await this.deps.torrents.setRecycling.execute({
          username: Username.parse(job.payload.username),
          mode: RecyclingMode.parse(job.payload.mode),
        });
        return job;
      case 'set-allow-public-tracker':
        await this.deps.torrents.setAllowPublicTracker.execute({
          username: Username.parse(job.payload.username),
          allowed: job.payload.allowed,
        });
        return job;
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
          return { ...job, report: verdict };
        }
        return { ...job, report: undefined };
      case 'discover-tracker': {
        const report = await this.deps.trackers.discover.execute({
          url: job.payload.url,
          privacy: job.payload.privacy,
          today: nowStamp().slice(0, 10),
        });
        return { ...job, report };
      }
      case 'fetch-tracker-cert': {
        const report = await this.deps.trackers.fetchCert.execute({
          host: TrackerHost.parse(job.payload.host),
          now: nowStamp(),
        });
        return { ...job, report };
      }
      case 'renew-tracker-certs': {
        const report = await this.deps.trackers.renewCerts.execute({
          today: job.payload.today,
          now: nowStamp(),
        });
        return { ...job, report };
      }
      case 'mark-tracker-dead': {
        const report = await this.deps.trackers.markDead.execute({
          host: TrackerHost.parse(job.payload.host),
        });
        return { ...job, report };
      }
      // the import enables lists; without a download right after, the kernel
      // set stays empty until the next scheduled update, hours later
      case 'import-blocklist-catalog':
        await this.deps.trackers.importCatalog.execute();
        return job;
      case 'update-blocklists': {
        const report = await this.deps.trackers.updateBlocklists.execute({ now: nowStamp() });
        return { ...job, report };
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
        return job;
      case 'render-whitelist':
        await this.deps.trackers.renderWhitelist.execute();
        return job;
      case 'render-blocklist-filters':
        await this.deps.trackers.renderBlocklistFilters.execute({
          ...(job.payload.username !== undefined && {
            username: Username.parse(job.payload.username),
          }),
        });
        return job;
      case 'apply-firewall':
        await this.deps.security.applyFirewall.execute();
        return job;
      case 'render-fail2ban':
        await this.deps.security.renderFail2ban.execute();
        return job;
      case 'add-user-hostname':
      case 'remove-user-hostname':
        return {
          ...job,
          report: await this.deps.security.manageUserHostname.execute({
            action: job.type === 'add-user-hostname' ? 'add' : 'remove',
            username: Username.parse(job.payload.username),
            host: DynDnsHost.parse(job.payload.hostname),
          }),
        };
      case 'resolve-dyndns': {
        const report = await this.deps.security.resolveDynDns.execute();
        return { ...job, report };
      }
      case 'render-openvpn':
        await this.deps.security.renderOpenVpn.execute();
        return job;
      case 'provision-vpn-user':
        return {
          ...job,
          report: await this.deps.security.provisionVpnUser.execute({
            username: Username.parse(job.payload.username),
          }),
        };
      case 'deprovision-vpn-user':
        return {
          ...job,
          report: await this.deps.security.deprovisionVpnUser.execute({
            username: Username.parse(job.payload.username),
          }),
        };
      case 'evaluate-fair-use':
        await this.deps.security.evaluateFairUse.execute({ now: nowStamp() });
        return job;
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
        return job;
      case 'send-mails':
        await this.deps.maintenance.sendMails.execute({ now: nowStamp() });
        return job;
      case 'index-media':
        await this.deps.torrents.indexMedia.execute();
        return job;
      case 'restart-service':
        await this.deps.maintenance.restartService.execute({
          service: ManagedService.parse(job.payload.service),
        });
        return job;
      case 'capture-service-log':
        await this.deps.maintenance.captureServiceLog.execute(
          LoggableService.parse(job.payload.service),
        );
        return job;
      case 'check-package-updates':
        await this.deps.maintenance.checkPackageUpdates.execute();
        return job;
      case 'apply-package-updates':
        await this.deps.maintenance.applyPackageUpdates.execute();
        return job;
      case 'run-speedtest':
        await this.deps.maintenance.runSpeedtest.execute();
        return job;
      case 'run-backup': {
        const report = await this.deps.maintenance.runBackup.execute({ now: nowStamp() });
        // the rest of the backup went through: a warning, not a failed job
        for (const failure of report.failedMembers) {
          this.deps.logger.warn(failure, 'backup: restart kit not archived');
        }
        return job;
      }
      case 'apply-ipset':
        await this.deps.trackers.applyIpset.execute();
        return job;
      case 'render-rutorrent-users':
        await this.deps.torrents.renderRutorrentUsers.execute();
        return job;
      case 'render-nfs-exports':
        await this.deps.security.renderNfsExports.execute();
        return job;
      case 'reserve-member-ports':
        await this.deps.useCases.reserveMemberPorts.execute();
        return job;
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
        return job;
      }
      case 'set-automatic-cleanup':
        await this.deps.space.setAutomaticCleanup.execute({
          username: Username.parse(job.payload.username),
          automatic: parseAutomaticCleanup(job.payload.scope),
        });
        return job;
      case 'set-seed-rule':
        await this.deps.space.setSeedRule.execute(SeedRule.of(job.payload));
        return job;
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
        return job;
      }
      case 'add-user-address':
      case 'remove-user-address': {
        const report = await this.deps.trackers.manageUserAddress.execute({
          action: job.type === 'add-user-address' ? 'add' : 'remove',
          username: Username.parse(job.payload.username),
          ip: IpAddress.parse(job.payload.ipv4),
        });
        return { ...job, report };
      }
    }
    // every case returns: a job type added to the contract without one does
    // not compile, rather than being marked done without anything run
    const unhandled: never = job;
    throw new Error(`no worker case for job ${JSON.stringify(unhandled)}`);
  }
}
