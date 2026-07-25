import { parseJob, type Job } from '../../application/jobs/contract.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import type { MailOutboxPort } from '../../application/maintenance/MailOutboxPort.js';
import { parseRole } from '../../domain/portal/Role.js';
import { DynDnsHost } from '../../domain/security/DynDnsHost.js';
import { IpAddress } from '../../domain/shared/IpAddress.js';
import { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import { EventHook } from '../../domain/torrent/EventHook.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { Label } from '../../domain/torrent/Label.js';
import { AccountType } from '../../domain/user/AccountType.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { HashedPassword } from '../../domain/user/HashedPassword.js';
import { ProxyPort } from '../../domain/user/Port.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import type {
  MaintenanceUseCases,
  SecurityUseCases,
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
      case 'set-sync-disabled':
        await this.torrents.setSyncDisabled.execute({
          username: Username.parse(job.payload.username),
          disabled: job.payload.disabled,
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
        });
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
      case 'run-backup':
        await this.maintenance.runBackup.execute({ now: nowStamp() });
        return;
      case 'apply-ipset':
        await this.trackers.applyIpset.execute();
        return;
      case 'add-user-address':
      case 'remove-user-address': {
        const report = await this.trackers.manageUserAddress.execute({
          action: job.type === 'add-user-address' ? 'add' : 'remove',
          username: Username.parse(job.payload.username),
          ip: IpAddress.parse(job.payload.ipv4),
        });
        // a member address is rendered in three places: allow.p2p, the
        // firewall trusted rules and fail2ban ignoreip — refresh all of them
        return {
          whitelistDirty: report.whitelistDirty,
          firewallDirty: report.whitelistDirty,
          fail2banDirty: report.whitelistDirty,
        };
      }
    }
  }
}
