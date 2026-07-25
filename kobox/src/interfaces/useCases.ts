import { DiscoverTrackerFromTorrent } from '../application/tracker/DiscoverTrackerFromTorrent.js';
import { FetchTrackerCert } from '../application/tracker/FetchTrackerCert.js';
import { ImportBlocklistCatalog } from '../application/tracker/ImportBlocklistCatalog.js';
import { ApplyIpset } from '../application/tracker/ApplyIpset.js';
import { ManageUserAddress } from '../application/tracker/ManageUserAddress.js';
import { MarkTrackerDead } from '../application/tracker/MarkTrackerDead.js';
import { RenderBlocklistFilters } from '../application/tracker/RenderBlocklistFilters.js';
import { RenderWhitelist } from '../application/tracker/RenderWhitelist.js';
import { RenewTrackerCerts } from '../application/tracker/RenewTrackerCerts.js';
import { UpdateBlocklists, type IblocklistCredentials } from '../application/tracker/UpdateBlocklists.js';
import { AddWatchDir } from '../application/torrent/AddWatchDir.js';
import { DeprovisionRtorrentInstance } from '../application/torrent/DeprovisionRtorrentInstance.js';
import { HandleTorrentEvent } from '../application/torrent/HandleTorrentEvent.js';
import { ProvisionRtorrentInstance } from '../application/torrent/ProvisionRtorrentInstance.js';
import { RenderRtorrentConfig } from '../application/torrent/RenderRtorrentConfig.js';
import { SetAllowPublicTracker } from '../application/torrent/SetAllowPublicTracker.js';
import { SetSyncDisabled } from '../application/torrent/SetSyncDisabled.js';
import type { BackupHostPort } from '../application/maintenance/BackupHostPort.js';
import type { MailOutboxPort } from '../application/maintenance/MailOutboxPort.js';
import type { MailTransportPort } from '../application/maintenance/MailTransportPort.js';
import { RunBackup, type BackupSettings } from '../application/maintenance/RunBackup.js';
import { SendMails } from '../application/maintenance/SendMails.js';
import { ApplyFirewall } from '../application/security/ApplyFirewall.js';
import { DeprovisionVpnUser } from '../application/security/DeprovisionVpnUser.js';
import { EvaluateFairUse } from '../application/security/EvaluateFairUse.js';
import { SetFairUseOverride } from '../application/security/SetFairUseOverride.js';
import { ProvisionVpnUser } from '../application/security/ProvisionVpnUser.js';
import { ManageUserHostname } from '../application/security/ManageUserHostname.js';
import { RenderFail2ban } from '../application/security/RenderFail2ban.js';
import { RenderOpenVpn } from '../application/security/RenderOpenVpn.js';
import { ResolveDynDns } from '../application/security/ResolveDynDns.js';
import type { SecuritySettings } from '../application/security/settings.js';
import { ChangePassword } from '../application/user/ChangePassword.js';
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
import type {
  HealthProbePort,
  NotificationPort,
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
  readonly sftp: SftpPort;
  readonly services: ServiceControlPort;
  readonly notifications: NotificationPort;
  readonly allocator: PortAllocatorPort;
  readonly credentials: PortalCredentialsPort;
  readonly sessions: SessionStorePort;
  readonly clock: () => string;
}

export interface UseCases {
  readonly createUser: CreateUser;
  readonly deleteUser: DeleteUser;
  readonly changePassword: ChangePassword;
  readonly suspendUser: SuspendUser;
  readonly resumeUser: ResumeUser;
}

export function buildUseCases(deps: UseCaseDeps): UseCases {
  return {
    createUser: new CreateUser(deps),
    deleteUser: new DeleteUser(deps),
    changePassword: new ChangePassword(deps),
    suspendUser: new SuspendUser(deps),
    resumeUser: new ResumeUser(deps),
  };
}

export interface MaintenanceUseCaseDeps {
  readonly outbox: MailOutboxPort;
  readonly transport: MailTransportPort;
  readonly backupHost: BackupHostPort;
  readonly backupSettings: BackupSettings;
}

export interface MaintenanceUseCases {
  readonly sendMails: SendMails;
  readonly runBackup: RunBackup;
}

export function buildMaintenanceUseCases(deps: MaintenanceUseCaseDeps): MaintenanceUseCases {
  return {
    sendMails: new SendMails(deps),
    runBackup: new RunBackup({ backupHost: deps.backupHost, settings: deps.backupSettings }),
  };
}

export interface TorrentUseCaseDeps {
  readonly users: UserRepository;
  readonly instances: TorrentInstanceRepository;
  readonly torrents: TorrentRepository;
  readonly config: RtorrentConfigPort;
  readonly watchDirs: WatchDirPort;
  readonly services: ServiceControlPort;
  readonly metainfo: TorrentMetainfoPort;
  readonly control: RtorrentControlPort;
  readonly scripts: UserScriptRunnerPort;
  readonly announcers: AnnouncerSink;
  readonly templates: RtorrentTemplates;
  readonly settings: RenderSettings;
}

export interface TorrentUseCases {
  readonly provision: ProvisionRtorrentInstance;
  readonly deprovision: DeprovisionRtorrentInstance;
  readonly render: RenderRtorrentConfig;
  readonly addWatchDir: AddWatchDir;
  readonly setSyncDisabled: SetSyncDisabled;
  readonly setAllowPublicTracker: SetAllowPublicTracker;
  readonly handleEvent: HandleTorrentEvent;
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
  };
}

export function buildTorrentUseCases(deps: TorrentUseCaseDeps): TorrentUseCases {
  const render = new RenderRtorrentConfig(deps);
  return {
    provision: new ProvisionRtorrentInstance(deps),
    deprovision: new DeprovisionRtorrentInstance(deps),
    render,
    addWatchDir: new AddWatchDir({ instances: deps.instances, render }),
    setSyncDisabled: new SetSyncDisabled(deps),
    setAllowPublicTracker: new SetAllowPublicTracker(deps),
    handleEvent: new HandleTorrentEvent(deps),
  };
}
