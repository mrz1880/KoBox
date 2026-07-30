import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseJob } from '../application/jobs/contract.js';
import { ImportFromMysb } from '../application/migration/ImportFromMysb.js';
import { buildInstallers, type InstallerContext } from '../application/installation/installers.js';
import { RunInstallation } from '../application/installation/RunInstallation.js';
import { UninstallComponents } from '../application/installation/UninstallComponents.js';
import { COMPONENT_CATALOG } from '../domain/installation/catalog.js';
import { SqliteComponentRegistry } from '../infrastructure/persistence/SqliteComponentRegistry.js';
import { AptPackageAdapter } from '../infrastructure/system/AptPackageAdapter.js';
import {
  ArtifactFetchAdapter,
  defaultBodyFetcher,
} from '../infrastructure/system/ArtifactFetchAdapter.js';
import { CertbotAdapter } from '../infrastructure/system/CertbotAdapter.js';
import { ConfigCheckAdapter } from '../infrastructure/system/ConfigCheckAdapter.js';
import { InstallHostAdapter } from '../infrastructure/system/InstallHostAdapter.js';
import { SystemdAdapter } from '../infrastructure/system/SystemdAdapter.js';
import { SystemFactsAdapter } from '../infrastructure/system/SystemFactsAdapter.js';
import { createLogger, type Logger } from '../infrastructure/logging/logger.js';
import { ConsoleNotificationAdapter } from '../infrastructure/notifications/ConsoleNotificationAdapter.js';
import { DiscordChannel } from '../infrastructure/notifications/DiscordChannel.js';
import type { BackupSettings } from '../application/maintenance/RunBackup.js';
import { UpgradeRelease } from '../application/maintenance/UpgradeRelease.js';
import { BackupHostAdapter } from '../infrastructure/system/BackupHostAdapter.js';
import { GitAdapter } from '../infrastructure/system/GitAdapter.js';
import { UpgradeHostAdapter } from '../infrastructure/system/UpgradeHostAdapter.js';
import { SqliteReleaseRepository } from '../infrastructure/persistence/SqliteReleaseRepository.js';
import { MultiChannelNotifier } from '../infrastructure/notifications/MultiChannelNotifier.js';
import { OutboxEmailChannel } from '../infrastructure/notifications/OutboxEmailChannel.js';
import { SendmailTransport } from '../infrastructure/notifications/SendmailTransport.js';
import { SqliteMailOutbox } from '../infrastructure/persistence/SqliteMailOutbox.js';
import { SqliteMysbDumpSource } from '../infrastructure/persistence/SqliteMysbDumpSource.js';
import { SqliteDebridDownloadRepository } from '../infrastructure/persistence/SqliteDebridDownloadRepository.js';
import { AllDebridAdapter } from '../infrastructure/system/AllDebridAdapter.js';
import { Aria2Adapter } from '../infrastructure/system/Aria2Adapter.js';
import { DdlPlacementAdapter } from '../infrastructure/system/DdlPlacementAdapter.js';
import { NtfyChannel } from '../infrastructure/notifications/NtfyChannel.js';
import type { NotificationChannel } from '../infrastructure/notifications/formatEvent.js';
import type { SecurityNotificationPort } from '../domain/security/ports.js';
import type { TrackerNotificationPort } from '../domain/tracker/ports.js';
import type { NotificationPort } from '../domain/user/ports.js';
import { KoboxDatabase } from '../infrastructure/persistence/db.js';
import { SqliteBlocklistRepository } from '../infrastructure/persistence/SqliteBlocklistRepository.js';
import { SqliteJobQueue } from '../infrastructure/persistence/SqliteJobQueue.js';
import { SqliteLoginAttemptsRepository } from '../infrastructure/persistence/SqliteLoginAttemptsRepository.js';
import { SqlitePortalCredentialsRepository } from '../infrastructure/persistence/SqlitePortalCredentialsRepository.js';
import { SqlitePortalSessionRepository } from '../infrastructure/persistence/SqlitePortalSessionRepository.js';
import { SqlitePortAllocator } from '../infrastructure/persistence/SqlitePortAllocator.js';
import { SqliteTorrentInstanceRepository } from '../infrastructure/persistence/SqliteTorrentInstanceRepository.js';
import { SqliteTorrentRepository } from '../infrastructure/persistence/SqliteTorrentRepository.js';
import { SqliteTrackerRepository } from '../infrastructure/persistence/SqliteTrackerRepository.js';
import { SqliteUserAddressRepository } from '../infrastructure/persistence/SqliteUserAddressRepository.js';
import { SqliteUserRepository } from '../infrastructure/persistence/SqliteUserRepository.js';
import {
  DEFAULT_SPOOL_DIR,
  GetentUsernameResolver,
  TorrentEventSpoolSweeper,
} from '../infrastructure/spool/TorrentEventSpool.js';
import { EnqueueAnnouncerSink } from '../infrastructure/jobs/EnqueueAnnouncerSink.js';
import { BencodeMetainfoAdapter } from '../infrastructure/system/BencodeMetainfoAdapter.js';
import { CertStoreAdapter } from '../infrastructure/system/CertStoreAdapter.js';
import { ExecFileRunner } from '../infrastructure/system/CommandRunner.js';
import { DnsLookupResolverAdapter } from '../infrastructure/system/DnsLookupResolverAdapter.js';
import { FsBlocklistCacheAdapter } from '../infrastructure/system/FsBlocklistCacheAdapter.js';
import { HttpsBlocklistDownloadAdapter } from '../infrastructure/system/HttpsBlocklistDownloadAdapter.js';
import { IblocklistCatalogAdapter } from '../infrastructure/system/IblocklistCatalogAdapter.js';
import { IpsetAdapter } from '../infrastructure/system/IpsetAdapter.js';
import { Cidr } from '../domain/security/Cidr.js';
import { Bandwidth } from '../domain/security/Bandwidth.js';
import { DynDnsHost } from '../domain/security/DynDnsHost.js';
import { Password } from '../domain/user/Password.js';
import { FairUsePolicy } from '../domain/security/FairUsePolicy.js';
import { SqliteFairUseRepository } from '../infrastructure/persistence/SqliteFairUseRepository.js';
import { DynDnsLookupAdapter } from '../infrastructure/system/DynDnsLookupAdapter.js';
import { DEFAULT_PKI_DIR } from '../infrastructure/system/FsVpnPkiAdapter.js';
import { EasyRsaPkiAdapter } from '../infrastructure/system/EasyRsaPkiAdapter.js';
import { IptablesUsageMeterAdapter } from '../infrastructure/system/IptablesUsageMeterAdapter.js';
import { JournaldSshAuthAdapter } from '../infrastructure/system/JournaldSshAuthAdapter.js';
import { TcShapingAdapter } from '../infrastructure/system/TcShapingAdapter.js';
import { GetentUserIdentityAdapter } from '../infrastructure/system/GetentUserIdentityAdapter.js';
import { IptablesRestoreAdapter } from '../infrastructure/system/IptablesRestoreAdapter.js';
import { NetworkServiceAdapter } from '../infrastructure/system/NetworkServiceAdapter.js';
import { OpensslTrackerCertAdapter } from '../infrastructure/system/OpensslTrackerCertAdapter.js';
import { OpensslPasswordHasher } from '../infrastructure/system/OpensslPasswordHasher.js';
import { ProcessSocketHealthProbe } from '../infrastructure/system/ProcessSocketHealthProbe.js';
import { NoopQuotaAdapter, QuotaAdapter } from '../infrastructure/system/QuotaAdapter.js';
import { RtorrentConfigAdapter } from '../infrastructure/system/RtorrentConfigAdapter.js';
import { ScgiRtorrentControlAdapter } from '../infrastructure/system/ScgiRtorrentControlAdapter.js';
import { SftpAdapter } from '../infrastructure/system/SftpAdapter.js';
import { SystemAccountAdapter } from '../infrastructure/system/SystemAccountAdapter.js';
import { SystemdServiceControlAdapter } from '../infrastructure/system/SystemdServiceControlAdapter.js';
import { UserScriptRunnerAdapter } from '../infrastructure/system/UserScriptRunnerAdapter.js';
import { WatchDirAdapter } from '../infrastructure/system/WatchDirAdapter.js';
import { loadRtorrentTemplates } from '../infrastructure/templates/TemplateProvider.js';
import { JobWorker } from './worker/JobWorker.js';
import {
  buildDdlUseCases,
  buildMaintenanceUseCases,
  buildSecurityUseCases,
  buildTorrentUseCases,
  buildTrackerUseCases,
  buildUseCases,
  type DdlUseCases,
  type MaintenanceUseCases,
  type SecurityUseCases,
  type TorrentUseCases,
  type TrackerUseCases,
  type UseCases,
} from './useCases.js';
import type { SecuritySettings } from '../application/security/settings.js';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// The frozen alert channels (ntfy + email via Postfix + Discord), each armed
// by its env var; with none configured the Phase 0 console stub remains.
// Email is durable since Phase 5: alerts land in the mails outbox and the
// scheduled send-mails job flushes them through the relay.
function buildNotifier(
  logger: Logger,
  outbox: SqliteMailOutbox,
): NotificationPort & TrackerNotificationPort & SecurityNotificationPort {
  const channels: NotificationChannel[] = [];
  const ntfyUrl = process.env.KOBOX_NTFY_URL;
  if (ntfyUrl !== undefined && ntfyUrl !== '') {
    channels.push(new NtfyChannel(fetch, ntfyUrl));
  }
  const webhook = process.env.KOBOX_DISCORD_WEBHOOK;
  if (webhook !== undefined && webhook !== '') {
    channels.push(new DiscordChannel(fetch, webhook));
  }
  const email = process.env.KOBOX_ALERT_EMAIL;
  if (email !== undefined && email !== '') {
    channels.push(new OutboxEmailChannel(outbox, email, nowStamp));
  }
  return channels.length > 0
    ? new MultiChannelNotifier(channels, logger)
    : new ConsoleNotificationAdapter(logger);
}

export function fairUsePolicy(): FairUsePolicy {
  return FairUsePolicy.of({
    sustainedEgress: Bandwidth.mbit(envInt('KOBOX_FAIRUSE_EGRESS_MBIT', 50)),
    maxAuthPerHour: envInt('KOBOX_FAIRUSE_AUTH_PER_HOUR', 30),
    throttleTo: Bandwidth.mbit(envInt('KOBOX_FAIRUSE_THROTTLE_MBIT', 5)),
  });
}

export function securitySettings(): SecuritySettings {
  const vpnRemote = process.env.KOBOX_VPN_REMOTE;
  return {
    sshPort: envInt('KOBOX_SSH_PORT', 22),
    portalPort: envInt('KOBOX_PORTAL_PORT', 8189),
    ...(vpnRemote !== undefined && { vpnRemote: DynDnsHost.parse(vpnRemote) }),
    vpn: {
      tunGwPort: envInt('KOBOX_VPN_TUN_GW_PORT', 8193),
      tunPort: envInt('KOBOX_VPN_TUN_PORT', 8194),
      tapPort: envInt('KOBOX_VPN_TAP_PORT', 8195),
      tunGwSubnet: Cidr.parse(process.env.KOBOX_VPN_TUN_GW_SUBNET ?? '10.0.0.0/24'),
      tunSubnet: Cidr.parse(process.env.KOBOX_VPN_TUN_SUBNET ?? '10.0.1.0/24'),
      tapSubnet: Cidr.parse(process.env.KOBOX_VPN_TAP_SUBNET ?? '10.0.2.0/24'),
    },
  };
}

export const DEFAULT_DB_PATH = '/var/lib/kobox/kobox.db';
const DEFAULT_ARIA2_RPC_URL = 'http://127.0.0.1:6800/jsonrpc';
// outside /var/lib/kobox (2770 root:kobox-portal, untraversable by kobox-aria2)
const DEFAULT_DDL_STAGING = '/var/lib/kobox-aria2';
const DEFAULT_ALLDEBRID_BASE_URL = 'https://api.alldebrid.com';
export const DEFAULT_KOBOX_BIN = '/usr/local/bin/kobox';
export const DEFAULT_CURRENT_LINK = '/opt/kobox/current';
export const DEFAULT_RELEASES_DIR = '/opt/kobox/releases';

export function backupSettings(): BackupSettings {
  return {
    root: process.env.KOBOX_BACKUP_ROOT ?? '/var/backups/kobox',
    ttlDays: envInt('KOBOX_BACKUP_TTL_DAYS', 7),
    keepMin: envInt('KOBOX_BACKUP_KEEP_MIN', 3),
    configDirs: ['/etc/kobox', '/etc/letsencrypt'],
  };
}

// Snapshot of the KOBOX_* environment at install time: rendered into
// /etc/kobox/worker.env (0600) so the systemd worker sees the same
// configuration the installer was launched with.
export function koboxEnvSnapshot(): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('KOBOX_') && value !== undefined) {
      snapshot.set(key, value);
    }
  }
  return snapshot;
}

export interface InstallFlags {
  readonly allowNonExt4: boolean;
  readonly manageAptSources: boolean;
}

export interface InstallationWiring {
  readonly run: RunInstallation;
  readonly uninstall: UninstallComponents;
  readonly registry: SqliteComponentRegistry;
}

// Installation runs DIRECT as root (bootstrap problem: the worker unit does
// not exist yet); convergence still flows through the same typed job queue
// and JobWorker production uses.
export async function buildInstallation(
  c: Container,
  flags: InstallFlags,
): Promise<InstallationWiring> {
  const runner = new ExecFileRunner();
  const facts = await new SystemFactsAdapter(runner).gather();
  const rutorrentUrl = process.env.KOBOX_RUTORRENT_URL;
  const rutorrentSha256 = process.env.KOBOX_RUTORRENT_SHA256;
  const nanomonUrl = process.env.KOBOX_NANOMON_URL;
  const nanomonSha256 = process.env.KOBOX_NANOMON_SHA256;
  const aria2RpcSecret = process.env.KOBOX_ARIA2_RPC_SECRET;
  const ddlStagingDir = process.env.KOBOX_DDL_STAGING;
  const quotaFs = process.env.KOBOX_QUOTA_FS;
  const leDomain = process.env.KOBOX_LE_DOMAIN;
  const leEmail = process.env.KOBOX_LE_EMAIL;
  const acmeUrl = process.env.KOBOX_ACME_URL;
  const installPki = new EasyRsaPkiAdapter(runner, process.env.KOBOX_VPN_PKI ?? DEFAULT_PKI_DIR);
  const ctx: InstallerContext = {
    packages: new AptPackageAdapter(runner),
    files: new RtorrentConfigAdapter(runner),
    systemd: new SystemdAdapter(runner),
    checks: new ConfigCheckAdapter(runner),
    host: new InstallHostAdapter(runner),
    ipset: new IpsetAdapter(runner),
    certbot: new CertbotAdapter(runner, process.env.KOBOX_ACME_CA_BUNDLE),
    pki: installPki,
    pkiProvision: installPki,
    artifacts: new ArtifactFetchAdapter(defaultBodyFetcher()),
    facts,
    security: securitySettings(),
    install: {
      nodeBin: process.execPath,
      // the package root of the RUNNING build (contains dist/, node_modules)
      sourceDir: fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, ''),
      currentLink: process.env.KOBOX_CURRENT_LINK ?? DEFAULT_CURRENT_LINK,
      koboxBin: process.env.KOBOX_BIN ?? DEFAULT_KOBOX_BIN,
      manageAptSources: flags.manageAptSources,
      ...(rutorrentUrl !== undefined && rutorrentUrl !== '' && { rutorrentUrl }),
      ...(rutorrentSha256 !== undefined &&
        rutorrentSha256 !== '' && { rutorrentSha256 }),
      ...(nanomonUrl !== undefined && nanomonUrl !== '' && { nanomonUrl }),
      ...(nanomonSha256 !== undefined && nanomonSha256 !== '' && { nanomonSha256 }),
      ...(aria2RpcSecret !== undefined && aria2RpcSecret !== '' && { aria2RpcSecret }),
      ...(ddlStagingDir !== undefined && ddlStagingDir !== '' && { ddlStagingDir }),
      ...(quotaFs !== undefined && quotaFs !== '' && { quotaFs }),
      ...(leDomain !== undefined &&
        leDomain !== '' &&
        leEmail !== undefined &&
        leEmail !== '' && {
          letsencrypt: {
            domain: leDomain,
            email: leEmail,
            ...(acmeUrl !== undefined && acmeUrl !== '' && { acmeUrl }),
          },
        }),
      workerEnv: koboxEnvSnapshot(),
    },
  };
  const installers = buildInstallers(ctx);
  const registry = new SqliteComponentRegistry(c.db);
  const now = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const onProgress = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  return {
    run: new RunInstallation({
      facts: { gather: () => Promise.resolve(facts) },
      registry,
      packages: ctx.packages,
      installers,
      catalog: COMPONENT_CATALOG,
      enqueueConvergence: async (type) => {
        await c.queue.enqueue(parseJob(type, {}));
      },
      drain: () => c.worker.drain(),
      now,
      onProgress,
    }),
    uninstall: new UninstallComponents({
      registry,
      installers,
      catalog: COMPONENT_CATALOG,
      now,
      onProgress,
    }),
    registry,
  };
}

export function spoolDir(): string {
  return process.env.KOBOX_SPOOL ?? DEFAULT_SPOOL_DIR;
}

// Upgrades run DIRECT as root (never as a job: the worker cannot restart
// itself mid-job); they share the container's DB for the ledger and backups.
export function buildUpgrade(c: Container): UpgradeRelease {
  const runner = new ExecFileRunner();
  const sourceDir = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
  return new UpgradeRelease({
    git: new GitAdapter(runner),
    releases: new SqliteReleaseRepository(c.db),
    host: new UpgradeHostAdapter(runner),
    backup: c.maintenanceUseCases.runBackup,
    settings: {
      // the source repo root: the checkout the box was bootstrapped from
      repoDir: process.env.KOBOX_REPO_DIR ?? sourceDir.slice(0, sourceDir.lastIndexOf('/')),
      releasesDir: process.env.KOBOX_RELEASES_DIR ?? DEFAULT_RELEASES_DIR,
      currentLink: process.env.KOBOX_CURRENT_LINK ?? DEFAULT_CURRENT_LINK,
      packageSubdir: 'kobox',
    },
  });
}

// Reads a frozen MySB dump and imports it via existing repos/use cases. Runs
// DIRECT (like install/upgrade): it calls CreateUser and enqueues provisioning,
// so the running root worker finishes the per-user system state. The temporary
// password is a fresh CSPRNG string, hashed for the account and mailed once.
export function buildMigrateFromMysb(
  c: Container,
  opts: { readonly dumpDir: string },
): ImportFromMysb {
  return new ImportFromMysb({
    source: new SqliteMysbDumpSource(opts.dumpDir),
    users: c.repo,
    createUser: c.useCases.createUser,
    suspendUser: c.useCases.suspendUser,
    instances: new SqliteTorrentInstanceRepository(c.db),
    trackers: c.trackerRepo,
    blocklists: c.blocklistRepo,
    torrents: new SqliteTorrentRepository(c.db),
    addresses: c.addressRepo,
    bindings: c.addressRepo,
    hasher: c.hasher,
    newTemporaryPassword: () => Password.parse(randomBytes(18).toString('base64url')),
    outbox: c.outbox,
    queue: c.queue,
    clock: nowStamp,
  });
}

export interface Container {
  readonly db: KoboxDatabase;
  readonly logger: Logger;
  readonly useCases: UseCases;
  readonly torrentUseCases: TorrentUseCases;
  readonly trackerUseCases: TrackerUseCases;
  readonly securityUseCases: SecurityUseCases;
  readonly maintenanceUseCases: MaintenanceUseCases;
  readonly outbox: SqliteMailOutbox;
  readonly ddlUseCases: DdlUseCases;
  readonly debridDownloadRepo: SqliteDebridDownloadRepository;
  readonly queue: SqliteJobQueue;
  readonly worker: JobWorker;
  readonly hasher: OpensslPasswordHasher;
  readonly repo: SqliteUserRepository;
  readonly trackerRepo: SqliteTrackerRepository;
  readonly blocklistRepo: SqliteBlocklistRepository;
  readonly addressRepo: SqliteUserAddressRepository;
  readonly healthProbe: ProcessSocketHealthProbe;
  readonly spoolSweeper: TorrentEventSpoolSweeper;
  readonly fairUseRepo: SqliteFairUseRepository;
  readonly usageMeter: IptablesUsageMeterAdapter;
  readonly credentials: SqlitePortalCredentialsRepository;
  readonly sessions: SqlitePortalSessionRepository;
  readonly loginAttempts: SqliteLoginAttemptsRepository;
  readonly componentRegistry: SqliteComponentRegistry;
  readonly releaseRepo: SqliteReleaseRepository;
}

export function buildContainer(name: string): Container {
  const logger = createLogger(name);
  const dbPath = process.env.KOBOX_DB ?? DEFAULT_DB_PATH;
  const db = KoboxDatabase.open(dbPath);
  const runner = new ExecFileRunner();
  const repo = new SqliteUserRepository(db);
  const quotaFs = process.env.KOBOX_QUOTA_FS;
  const quota = quotaFs
    ? new QuotaAdapter(runner, quotaFs)
    : new NoopQuotaAdapter((username) => {
        logger.warn({ username }, 'quota enforcement skipped: KOBOX_QUOTA_FS not set');
      });
  const services = new SystemdServiceControlAdapter(runner);
  const outbox = new SqliteMailOutbox(db);
  const notifications = buildNotifier(logger, outbox);
  const credentials = new SqlitePortalCredentialsRepository(db);
  const sessions = new SqlitePortalSessionRepository(db);
  const loginAttempts = new SqliteLoginAttemptsRepository(db);
  const useCases = buildUseCases({
    repo,
    accounts: new SystemAccountAdapter(runner),
    quota,
    sftp: new SftpAdapter(runner),
    services,
    notifications,
    allocator: new SqlitePortAllocator(db),
    credentials,
    sessions,
    clock: nowStamp,
  });
  const queue = new SqliteJobQueue(db);
  const networkServices = new NetworkServiceAdapter(runner, logger, {
    // post-install contract: absent units are breakage, except components
    // kobox install honestly skips (dnscrypt-proxy is not packaged for
    // Debian 12)
    strict: process.env.KOBOX_STRICT_SERVICES === '1',
    tolerateAbsent: ['dnscrypt-proxy'],
  });
  const torrentUseCases = buildTorrentUseCases({
    users: repo,
    instances: new SqliteTorrentInstanceRepository(db),
    torrents: new SqliteTorrentRepository(db),
    config: new RtorrentConfigAdapter(runner),
    watchDirs: new WatchDirAdapter(runner),
    services,
    metainfo: new BencodeMetainfoAdapter(),
    control: new ScgiRtorrentControlAdapter(),
    scripts: new UserScriptRunnerAdapter(runner),
    announcers: new EnqueueAnnouncerSink(queue),
    templates: loadRtorrentTemplates(),
    settings: { koboxBin: process.env.KOBOX_BIN ?? DEFAULT_KOBOX_BIN },
    nginx: networkServices,
  });
  const iblocklistUser = process.env.KOBOX_IBLOCKLIST_USER;
  const iblocklistPin = process.env.KOBOX_IBLOCKLIST_PIN;
  const networkFiles = new RtorrentConfigAdapter(runner);
  const trackerRepo = new SqliteTrackerRepository(db);
  const blocklistRepo = new SqliteBlocklistRepository(db);
  const addressRepo = new SqliteUserAddressRepository(db);
  const ipset = new IpsetAdapter(runner);
  const healthProbe = new ProcessSocketHealthProbe(runner);
  const settings = securitySettings();
  const fairUseRepo = new SqliteFairUseRepository(db);
  const vpnPki = new EasyRsaPkiAdapter(runner, process.env.KOBOX_VPN_PKI ?? DEFAULT_PKI_DIR);
  const trackerUseCases = buildTrackerUseCases({
    trackers: trackerRepo,
    blocklists: blocklistRepo,
    addresses: addressRepo,
    users: repo,
    instances: new SqliteTorrentInstanceRepository(db),
    dns: new DnsLookupResolverAdapter(),
    certPort: new OpensslTrackerCertAdapter(runner),
    certStore: new CertStoreAdapter(networkFiles, runner, logger, process.env.KOBOX_CERTS_DIR),
    download: new HttpsBlocklistDownloadAdapter(logger),
    catalog: new IblocklistCatalogAdapter(logger, process.env.KOBOX_IBLOCKLIST_CATALOG_URL),
    cache: new FsBlocklistCacheAdapter(process.env.KOBOX_BLOCKLIST_CACHE),
    files: networkFiles,
    reload: networkServices,
    ipset,
    notifications,
    ...(iblocklistUser !== undefined &&
      iblocklistPin !== undefined && {
        credentials: { username: iblocklistUser, pin: iblocklistPin },
      }),
  });
  const securityUseCases = buildSecurityUseCases({
    users: repo,
    addresses: addressRepo,
    bindings: addressRepo,
    identity: new GetentUserIdentityAdapter(runner),
    firewall: new IptablesRestoreAdapter(runner, networkFiles, healthProbe, settings.sshPort),
    files: networkFiles,
    reload: networkServices,
    ipset,
    resolver: new DynDnsLookupAdapter(),
    // one adapter serves both the read side (renders) and the mutating side
    // (client cert lifecycle chained from create/delete-user)
    pki: vpnPki,
    pkiProvision: vpnPki,
    fairUse: fairUseRepo,
    meter: new IptablesUsageMeterAdapter(runner),
    authLog: new JournaldSshAuthAdapter(runner),
    shaping: new TcShapingAdapter(runner, process.env.KOBOX_WAN_IF ?? 'eth0'),
    health: healthProbe,
    policy: fairUsePolicy(),
    notifications,
    settings,
  });
  const maintenanceUseCases = buildMaintenanceUseCases({
    outbox,
    transport: new SendmailTransport(runner),
    backupHost: new BackupHostAdapter(runner, db),
    backupSettings: backupSettings(),
  });
  // DDL/debrid: the debrid key + aria2 secret live only here (worker env),
  // never in the DB or a job payload. Unset key = feature inert (unlock fails,
  // rows are marked failed, nothing else downloads).
  const debridDownloadRepo = new SqliteDebridDownloadRepository(db);
  const ddlUseCases = buildDdlUseCases({
    repo: debridDownloadRepo,
    debrid: new AllDebridAdapter(
      process.env.KOBOX_ALLDEBRID_APIKEY ?? '',
      process.env.KOBOX_ALLDEBRID_BASE_URL ?? DEFAULT_ALLDEBRID_BASE_URL,
    ),
    downloader: new Aria2Adapter(
      process.env.KOBOX_ARIA2_RPC_URL ?? DEFAULT_ARIA2_RPC_URL,
      process.env.KOBOX_ARIA2_RPC_SECRET ?? '',
    ),
    placement: new DdlPlacementAdapter(runner),
    queue,
    clock: nowStamp,
    stagingBase: process.env.KOBOX_DDL_STAGING ?? DEFAULT_DDL_STAGING,
  });
  return {
    db,
    logger,
    useCases,
    torrentUseCases,
    trackerUseCases,
    securityUseCases,
    maintenanceUseCases,
    outbox,
    queue,
    worker: new JobWorker(
      queue,
      useCases,
      torrentUseCases,
      trackerUseCases,
      securityUseCases,
      maintenanceUseCases,
      outbox,
      ddlUseCases,
    ),
    ddlUseCases,
    debridDownloadRepo,
    hasher: new OpensslPasswordHasher(runner),
    repo,
    trackerRepo,
    blocklistRepo,
    addressRepo,
    healthProbe,
    spoolSweeper: new TorrentEventSpoolSweeper(
      spoolDir(),
      new GetentUsernameResolver(runner).resolve,
    ),
    fairUseRepo,
    usageMeter: new IptablesUsageMeterAdapter(runner),
    credentials,
    sessions,
    loginAttempts,
    componentRegistry: new SqliteComponentRegistry(db),
    releaseRepo: new SqliteReleaseRepository(db),
  };
}
