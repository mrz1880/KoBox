import { PollDebridDownloads } from '../application/ddl/PollDebridDownloads.js';
import { RequestDebridDownload } from '../application/ddl/RequestDebridDownload.js';
import { StartDebridDownload } from '../application/ddl/StartDebridDownload.js';
import { ClearDebridKey, StoreDebridKey } from '../application/ddl/StoreDebridKey.js';
import type {
  DebridAccountRepository,
  DebridCredentialsPort,
  DebridDownloadRepository,
  DebridPort,
  DownloaderPort,
  DownloadPlacementPort,
} from '../domain/ddl/ports.js';
import type { JobQueuePort } from '../application/jobs/JobQueuePort.js';
import { DiscoverTrackerFromTorrent } from '../application/tracker/DiscoverTrackerFromTorrent.js';
import { FetchTrackerCert } from '../application/tracker/FetchTrackerCert.js';
import { ImportBlocklistCatalog } from '../application/tracker/ImportBlocklistCatalog.js';
import { ApplyIpset } from '../application/tracker/ApplyIpset.js';
import { ManageUserAddress } from '../application/tracker/ManageUserAddress.js';
import { MarkTrackerDead } from '../application/tracker/MarkTrackerDead.js';
import { RebuildBlocklistCache } from '../application/tracker/RebuildBlocklistCache.js';
import { SetBlocklistEnabled } from '../application/tracker/SetBlocklistEnabled.js';
import { RenderBlocklistFilters } from '../application/tracker/RenderBlocklistFilters.js';
import { RenderWhitelist } from '../application/tracker/RenderWhitelist.js';
import { RenewTrackerCerts } from '../application/tracker/RenewTrackerCerts.js';
import { UpdateBlocklists, type IblocklistCredentials } from '../application/tracker/UpdateBlocklists.js';
import { AddWatchDir } from '../application/torrent/AddWatchDir.js';
import { SetCategorySyncMode } from '../application/torrent/SetCategorySyncMode.js';
import { CheckSyncDestination } from '../application/sync/CheckSyncDestination.js';
import { QueueFinishedDownload } from '../application/sync/QueueFinishedDownload.js';
import { RequeueTransfer } from '../application/sync/RequeueTransfer.js';
import { SendPendingTransfers } from '../application/sync/SendPendingTransfers.js';
import type {
  FileTransferPort,
  LocalFileFactsPort,
  RemotePasswordOpenerPort,
  RemoteProbePort,
  SyncDestinationRepository,
  SyncTransferRepository,
} from '../domain/sync/ports.js';
import { DeprovisionRtorrentInstance } from '../application/torrent/DeprovisionRtorrentInstance.js';
import { HandleTorrentEvent } from '../application/torrent/HandleTorrentEvent.js';
import { RestartRtorrentInstance } from '../application/torrent/RestartRtorrentInstance.js';
import { IndexUserMedia } from '../application/media/IndexUserMedia.js';
import type { MediaRepository, MediaScanPort } from '../domain/media/ports.js';
import { ProvisionRtorrentInstance } from '../application/torrent/ProvisionRtorrentInstance.js';
import { RenderRtorrentConfig } from '../application/torrent/RenderRtorrentConfig.js';
import { RenderRutorrentUsers } from '../application/torrent/RenderRutorrentUsers.js';
import { SetRecycling } from '../application/torrent/SetRecycling.js';
import { SetAllowPublicTracker } from '../application/torrent/SetAllowPublicTracker.js';
import { SetSyncDisabled } from '../application/torrent/SetSyncDisabled.js';
import type { BackupHostPort } from '../application/maintenance/BackupHostPort.js';
import type { InstallHostPort } from '../domain/installation/ports.js';
import type { ContentRecyclerPort } from '../domain/torrent/ports.js';
import type { MailOutboxPort } from '../application/maintenance/MailOutboxPort.js';
import type { MailTransportPort } from '../application/maintenance/MailTransportPort.js';
import { RunBackup, type BackupSettings } from '../application/maintenance/RunBackup.js';
import { RunSpeedtest } from '../application/maintenance/RunSpeedtest.js';
import { RestartService } from '../application/maintenance/RestartService.js';
import {
  ApplyPackageUpdates,
  CaptureServiceLog,
  CheckPackageUpdates,
} from '../application/maintenance/CaptureDiagnostics.js';
import type {
  DiagnosticsRepositoryPort,
  PackageUpdatePort,
  ServiceLogPort,
} from '../application/maintenance/DiagnosticsPort.js';
import type { SystemdPort } from '../domain/installation/ports.js';
import type {
  SpeedtestPort,
  SpeedtestRepositoryPort,
} from '../application/maintenance/SpeedtestPort.js';
import {
  ApplyStoredMailRelay,
  ConfigureMailRelay,
  type MailRelayRepository,
} from '../application/maintenance/ConfigureMailRelay.js';
import { SendMails } from '../application/maintenance/SendMails.js';
import { ApplyFirewall } from '../application/security/ApplyFirewall.js';
import { DeprovisionVpnUser } from '../application/security/DeprovisionVpnUser.js';
import { EvaluateFairUse } from '../application/security/EvaluateFairUse.js';
import { RenderNfsExports } from '../application/security/RenderNfsExports.js';
import { SetFairUseOverride } from '../application/security/SetFairUseOverride.js';
import { ProvisionVpnUser } from '../application/security/ProvisionVpnUser.js';
import { ManageUserHostname } from '../application/security/ManageUserHostname.js';
import { RenderFail2ban } from '../application/security/RenderFail2ban.js';
import { RenderOpenVpn } from '../application/security/RenderOpenVpn.js';
import { ResolveDynDns } from '../application/security/ResolveDynDns.js';
import type { SecuritySettings } from '../application/security/settings.js';
import { ChangePassword } from '../application/user/ChangePassword.js';
import { ProvisionNextcloudAccount } from '../application/user/ProvisionNextcloudAccount.js';
import { RemoveSshKey, SetSshKey } from '../application/user/SetSshKey.js';
import { SampleDiskUsage } from '../application/user/SampleDiskUsage.js';
import { SetUserQuota } from '../application/user/SetUserQuota.js';
import { CreateUser } from '../application/user/CreateUser.js';
import { DeleteUser } from '../application/user/DeleteUser.js';
import { ResumeUser } from '../application/user/ResumeUser.js';
import { SuspendUser } from '../application/user/SuspendUser.js';
import type {
  AnnouncerSink,
  RtorrentConfigPort,
  RtorrentControlPort,
  TorrentInstanceRepository,
  TorrentMetainfoPort,
  TorrentRepository,
  UserScriptRunnerPort,
  WatchDirPort,
} from '../domain/torrent/ports.js';
import type { ManagedFilesPort } from '../domain/shared/files.js';
import type {
  BlocklistCachePort,
  BlocklistDownloadPort,
  BlocklistRepository,
  CertStorePort,
  DnsResolverPort,
  IblocklistCatalogPort,
  IpsetPort,
  NetworkServiceReloadPort,
  TrackerCertPort,
  TrackerNotificationPort,
  TrackerRepository,
  UserAddressRepository,
} from '../domain/tracker/ports.js';
import type { FairUsePolicy } from '../domain/security/FairUsePolicy.js';
import type {
  DynDnsBindingRepository,
  DynDnsResolverPort,
  FairUseRepository,
  FirewallApplyPort,
  NetworkServicePort,
  SecurityNotificationPort,
  ShapingPort,
  SshAuthLogPort,
  UsageMeterPort,
  UserIdentityPort,
  VpnPkiPort,
  VpnPkiProvisionPort,
} from '../domain/security/ports.js';
import type { RenderSettings, RtorrentTemplates } from '../domain/torrent/rendering.js';
import type { PortalCredentialsPort, SessionStorePort } from '../domain/portal/ports.js';
import type { PortAllocatorPort } from '../domain/user/PortAllocatorPort.js';
import type { NextcloudPort } from '../domain/installation/NextcloudPort.js';
import type { Password } from '../domain/user/Password.js';
import type {
  HealthProbePort,
  NotificationPort,
  AuthorizedKeysPort,
  DiskUsageRepository,
  SshKeyRepository,
  QuotaPort,
  ServiceControlPort,
  SftpPort,
  SystemAccountPort,
  UserRepository,
} from '../domain/user/ports.js';

export interface UseCaseDeps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly quota: QuotaPort;
  readonly diskSamples: DiskUsageRepository;
  readonly nextcloud: NextcloudPort;
  readonly outbox: MailOutboxPort;
  readonly newPassword: () => Password;
  readonly sshKeys: SshKeyRepository;
  readonly authorizedKeys: AuthorizedKeysPort;
  readonly sftp: SftpPort;
  readonly services: ServiceControlPort;
  readonly notifications: NotificationPort;
  readonly allocator: PortAllocatorPort;
  readonly credentials: PortalCredentialsPort;
  readonly sessions: SessionStorePort;
  // delete-user must not leave the user's sealed debrid key behind
  readonly debridAccounts: DebridAccountRepository;
  readonly clock: () => string;
}

export interface UseCases {
  readonly createUser: CreateUser;
  readonly deleteUser: DeleteUser;
  readonly changePassword: ChangePassword;
  readonly setUserQuota: SetUserQuota;
  readonly sampleDiskUsage: SampleDiskUsage;
  readonly provisionNextcloudAccount: ProvisionNextcloudAccount;
  readonly setSshKey: SetSshKey;
  readonly removeSshKey: RemoveSshKey;
  readonly suspendUser: SuspendUser;
  readonly resumeUser: ResumeUser;
}

export function buildUseCases(deps: UseCaseDeps): UseCases {
  return {
    createUser: new CreateUser(deps),
    deleteUser: new DeleteUser(deps),
    changePassword: new ChangePassword(deps),
    setUserQuota: new SetUserQuota(deps),
    sampleDiskUsage: new SampleDiskUsage({ ...deps, samples: deps.diskSamples }),
    provisionNextcloudAccount: new ProvisionNextcloudAccount(deps),
    setSshKey: new SetSshKey({ ...deps, keys: deps.sshKeys, authorizedKeys: deps.authorizedKeys }),
    removeSshKey: new RemoveSshKey({ ...deps, keys: deps.sshKeys, authorizedKeys: deps.authorizedKeys }),
    suspendUser: new SuspendUser(deps),
    resumeUser: new ResumeUser(deps),
  };
}

export interface MaintenanceUseCaseDeps {
  readonly outbox: MailOutboxPort;
  readonly transport: MailTransportPort;
  readonly backupHost: BackupHostPort;
  readonly backupSettings: BackupSettings;
  readonly speedtest: SpeedtestPort;
  readonly systemd: SystemdPort;
  readonly logs: ServiceLogPort;
  readonly packageUpdates: PackageUpdatePort;
  readonly diagnostics: DiagnosticsRepositoryPort;
  readonly speedtests: SpeedtestRepositoryPort;
  readonly mailRelay: MailRelayRepository;
  readonly opener: RemotePasswordOpenerPort;
  readonly files: ManagedFilesPort;
  readonly installHost: InstallHostPort;
  readonly clock: () => string;
}

export interface MaintenanceUseCases {
  readonly sendMails: SendMails;
  readonly applyMailRelay: ApplyStoredMailRelay;
  readonly runBackup: RunBackup;
  readonly runSpeedtest: RunSpeedtest;
  readonly restartService: RestartService;
  readonly captureServiceLog: CaptureServiceLog;
  readonly checkPackageUpdates: CheckPackageUpdates;
  readonly applyPackageUpdates: ApplyPackageUpdates;
}

export function buildMaintenanceUseCases(deps: MaintenanceUseCaseDeps): MaintenanceUseCases {
  return {
    sendMails: new SendMails(deps),
    applyMailRelay: new ApplyStoredMailRelay({
      settings: deps.mailRelay,
      opener: deps.opener,
      configure: new ConfigureMailRelay({
        files: deps.files,
        host: deps.installHost,
        systemd: deps.systemd,
      }),
    }),
    runBackup: new RunBackup({ backupHost: deps.backupHost, settings: deps.backupSettings }),
    restartService: new RestartService({ systemd: deps.systemd }),
    captureServiceLog: new CaptureServiceLog({
      logs: deps.logs,
      repo: deps.diagnostics,
      clock: deps.clock,
    }),
    checkPackageUpdates: new CheckPackageUpdates({
      packages: deps.packageUpdates,
      repo: deps.diagnostics,
      clock: deps.clock,
    }),
    applyPackageUpdates: new ApplyPackageUpdates({
      packages: deps.packageUpdates,
      repo: deps.diagnostics,
      clock: deps.clock,
    }),
    runSpeedtest: new RunSpeedtest({
      speedtest: deps.speedtest,
      repo: deps.speedtests,
      clock: deps.clock,
    }),
  };
}

export interface TorrentUseCaseDeps {
  readonly users: UserRepository;
  readonly mediaScanner: MediaScanPort;
  readonly media: MediaRepository;
  readonly clock: () => string;
  readonly instances: TorrentInstanceRepository;
  readonly torrents: TorrentRepository;
  readonly config: RtorrentConfigPort;
  readonly watchDirs: WatchDirPort;
  readonly services: ServiceControlPort;
  readonly metainfo: TorrentMetainfoPort;
  readonly control: RtorrentControlPort;
  readonly scripts: UserScriptRunnerPort;
  readonly outbox: MailOutboxPort;
  readonly recycler: ContentRecyclerPort;
  readonly announcers: AnnouncerSink;
  readonly templates: RtorrentTemplates;
  readonly settings: RenderSettings;
  // nginx reload for the per-user /RPC-<USER> SCGI mounts (Phase 6)
  readonly nginx: NetworkServicePort;
}

export interface TorrentUseCases {
  readonly provision: ProvisionRtorrentInstance;
  readonly deprovision: DeprovisionRtorrentInstance;
  readonly render: RenderRtorrentConfig;
  readonly addWatchDir: AddWatchDir;
  readonly setCategorySyncMode: SetCategorySyncMode;
  readonly setSyncDisabled: SetSyncDisabled;
  readonly setAllowPublicTracker: SetAllowPublicTracker;
  readonly setRecycling: SetRecycling;
  readonly handleEvent: HandleTorrentEvent;
  readonly renderRutorrentUsers: RenderRutorrentUsers;
  readonly restart: RestartRtorrentInstance;
  readonly indexMedia: IndexUserMedia;
}

export interface TrackerUseCaseDeps {
  readonly trackers: TrackerRepository;
  readonly blocklists: BlocklistRepository;
  readonly addresses: UserAddressRepository;
  readonly users: UserRepository;
  readonly instances: TorrentInstanceRepository;
  readonly dns: DnsResolverPort;
  readonly certPort: TrackerCertPort;
  readonly certStore: CertStorePort;
  readonly download: BlocklistDownloadPort;
  readonly catalog: IblocklistCatalogPort;
  readonly cache: BlocklistCachePort;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServiceReloadPort;
  readonly ipset: IpsetPort;
  readonly notifications: TrackerNotificationPort;
  readonly credentials?: IblocklistCredentials;
}

export interface TrackerUseCases {
  readonly discover: DiscoverTrackerFromTorrent;
  readonly fetchCert: FetchTrackerCert;
  readonly renewCerts: RenewTrackerCerts;
  readonly markDead: MarkTrackerDead;
  readonly importCatalog: ImportBlocklistCatalog;
  readonly updateBlocklists: UpdateBlocklists;
  readonly renderWhitelist: RenderWhitelist;
  readonly renderBlocklistFilters: RenderBlocklistFilters;
  readonly setBlocklistEnabled: SetBlocklistEnabled;
  readonly rebuildBlocklistCache: RebuildBlocklistCache;
  readonly applyIpset: ApplyIpset;
  readonly manageUserAddress: ManageUserAddress;
}

export function buildTrackerUseCases(deps: TrackerUseCaseDeps): TrackerUseCases {
  const fetchCert = new FetchTrackerCert(deps);
  return {
    discover: new DiscoverTrackerFromTorrent(deps),
    fetchCert,
    renewCerts: new RenewTrackerCerts({ trackers: deps.trackers, fetchCert }),
    markDead: new MarkTrackerDead(deps),
    importCatalog: new ImportBlocklistCatalog(deps),
    updateBlocklists: new UpdateBlocklists(deps),
    renderWhitelist: new RenderWhitelist(deps),
    renderBlocklistFilters: new RenderBlocklistFilters(deps),
    setBlocklistEnabled: new SetBlocklistEnabled(deps),
    rebuildBlocklistCache: new RebuildBlocklistCache(deps),
    applyIpset: new ApplyIpset(deps),
    manageUserAddress: new ManageUserAddress(deps),
  };
}

export interface SecurityUseCaseDeps {
  readonly users: UserRepository;
  readonly addresses: UserAddressRepository;
  readonly bindings: DynDnsBindingRepository;
  readonly identity: UserIdentityPort;
  readonly firewall: FirewallApplyPort;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServicePort;
  readonly ipset: Pick<IpsetPort, 'ensureBlocklistSet'>;
  readonly resolver: DynDnsResolverPort;
  readonly pki: VpnPkiPort;
  readonly pkiProvision: VpnPkiProvisionPort;
  readonly fairUse: FairUseRepository;
  readonly meter: UsageMeterPort;
  readonly authLog: SshAuthLogPort;
  readonly shaping: ShapingPort;
  readonly health: HealthProbePort;
  readonly policy: FairUsePolicy;
  readonly notifications: SecurityNotificationPort;
  readonly settings: SecuritySettings;
}

export interface SecurityUseCases {
  readonly applyFirewall: ApplyFirewall;
  readonly setFairUseOverride: SetFairUseOverride;
  readonly renderFail2ban: RenderFail2ban;
  readonly manageUserHostname: ManageUserHostname;
  readonly resolveDynDns: ResolveDynDns;
  readonly renderOpenVpn: RenderOpenVpn;
  readonly provisionVpnUser: ProvisionVpnUser;
  readonly deprovisionVpnUser: DeprovisionVpnUser;
  readonly evaluateFairUse: EvaluateFairUse;
  readonly renderNfsExports: RenderNfsExports;
}

export function buildSecurityUseCases(deps: SecurityUseCaseDeps): SecurityUseCases {
  return {
    applyFirewall: new ApplyFirewall(deps),
    renderFail2ban: new RenderFail2ban(deps),
    manageUserHostname: new ManageUserHostname(deps),
    resolveDynDns: new ResolveDynDns(deps),
    renderOpenVpn: new RenderOpenVpn(deps),
    provisionVpnUser: new ProvisionVpnUser(deps),
    deprovisionVpnUser: new DeprovisionVpnUser(deps),
    evaluateFairUse: new EvaluateFairUse(deps),
    setFairUseOverride: new SetFairUseOverride(deps),
    renderNfsExports: new RenderNfsExports(deps),
  };
}

export function buildTorrentUseCases(deps: TorrentUseCaseDeps): TorrentUseCases {
  const render = new RenderRtorrentConfig(deps);
  return {
    provision: new ProvisionRtorrentInstance(deps),
    deprovision: new DeprovisionRtorrentInstance(deps),
    render,
    addWatchDir: new AddWatchDir({ instances: deps.instances, render }),
    setCategorySyncMode: new SetCategorySyncMode({ instances: deps.instances }),
    setSyncDisabled: new SetSyncDisabled(deps),
    setAllowPublicTracker: new SetAllowPublicTracker(deps),
    setRecycling: new SetRecycling(deps),
    handleEvent: new HandleTorrentEvent(deps),
    renderRutorrentUsers: new RenderRutorrentUsers({
      users: deps.users,
      files: deps.config,
      reload: deps.nginx,
    }),
    restart: new RestartRtorrentInstance({ users: deps.users, services: deps.services }),
    indexMedia: new IndexUserMedia({
      users: deps.users,
      scanner: deps.mediaScanner,
      repo: deps.media,
      clock: deps.clock,
    }),
  };
}

export interface DdlUseCaseDeps {
  readonly repo: DebridDownloadRepository;
  readonly accounts: DebridAccountRepository;
  readonly debrid: DebridPort;
  readonly credentials: DebridCredentialsPort;
  readonly downloader: DownloaderPort;
  readonly placement: DownloadPlacementPort;
  readonly queue: JobQueuePort;
  readonly clock: () => string;
  readonly stagingBase: string;
}

export interface DdlUseCases {
  readonly requestDownload: RequestDebridDownload;
  readonly startDownload: StartDebridDownload;
  readonly pollDownloads: PollDebridDownloads;
  readonly storeDebridKey: StoreDebridKey;
  readonly clearDebridKey: ClearDebridKey;
}

export function buildDdlUseCases(deps: DdlUseCaseDeps): DdlUseCases {
  return {
    requestDownload: new RequestDebridDownload({
      repo: deps.repo,
      queue: deps.queue,
      clock: deps.clock,
    }),
    startDownload: new StartDebridDownload({
      repo: deps.repo,
      debrid: deps.debrid,
      credentials: deps.credentials,
      downloader: deps.downloader,
      stagingBase: deps.stagingBase,
    }),
    pollDownloads: new PollDebridDownloads({
      repo: deps.repo,
      downloader: deps.downloader,
      placement: deps.placement,
    }),
    storeDebridKey: new StoreDebridKey({ accounts: deps.accounts, clock: deps.clock }),
    clearDebridKey: new ClearDebridKey({ accounts: deps.accounts }),
  };
}

export interface SyncUseCaseDeps {
  readonly users: UserRepository;
  readonly instances: TorrentInstanceRepository;
  readonly destinations: SyncDestinationRepository;
  readonly transfers: SyncTransferRepository;
  readonly opener: RemotePasswordOpenerPort;
  readonly probe: RemoteProbePort;
  readonly transport: FileTransferPort;
  readonly facts: LocalFileFactsPort;
  readonly clock: () => string;
  readonly hour: () => number;
}

// Root-side only. Sealing lives in the portal container: it needs the public
// half of the host key, opening needs the private one, and no single process
// should hold both.
export interface SyncUseCases {
  readonly checkDestination: CheckSyncDestination;
  readonly queueFinished: QueueFinishedDownload;
  readonly sendPending: SendPendingTransfers;
  readonly requeue: RequeueTransfer;
}

export function buildSyncUseCases(deps: SyncUseCaseDeps): SyncUseCases {
  return {
    checkDestination: new CheckSyncDestination({
      destinations: deps.destinations,
      opener: deps.opener,
      probe: deps.probe,
      clock: deps.clock,
    }),
    queueFinished: new QueueFinishedDownload({
      instances: deps.instances,
      transfers: deps.transfers,
      clock: deps.clock,
    }),
    sendPending: new SendPendingTransfers({
      users: deps.users,
      destinations: deps.destinations,
      transfers: deps.transfers,
      opener: deps.opener,
      transport: deps.transport,
      facts: deps.facts,
      clock: deps.clock,
      hour: deps.hour,
    }),
    requeue: new RequeueTransfer({ transfers: deps.transfers, clock: deps.clock }),
  };
}
