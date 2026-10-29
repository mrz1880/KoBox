import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseJob } from '../application/jobs/contract.js';
import { ImportFromMysb } from '../application/migration/ImportFromMysb.js';
import {
  buildInstallers,
  nextcloudSsoRelease,
  type InstallerContext,
} from '../application/installation/installers.js';
import { RunInstallation } from '../application/installation/RunInstallation.js';
import { UninstallComponents } from '../application/installation/UninstallComponents.js';
import { COMPONENT_CATALOG } from '../domain/installation/catalog.js';
import { stampOf } from '../domain/shared/stamp.js';
import { EmailAddress } from '../domain/user/EmailAddress.js';
import { SqliteComponentRegistry } from '../infrastructure/persistence/SqliteComponentRegistry.js';
import { AptPackageAdapter } from '../infrastructure/system/AptPackageAdapter.js';
import {
  ArtifactFetchAdapter,
  defaultBodyFetcher,
} from '../infrastructure/system/ArtifactFetchAdapter.js';
import { CertbotAdapter } from '../infrastructure/system/CertbotAdapter.js';
import { ConfigCheckAdapter } from '../infrastructure/system/ConfigCheckAdapter.js';
import { OccNextcloudAdapter } from '../infrastructure/system/OccNextcloudAdapter.js';
import { MvTorrentFiling } from '../infrastructure/system/MvTorrentFiling.js';
import { PhpFpmRutorrentPools } from '../infrastructure/system/PhpFpmRutorrentPools.js';
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
import { AccountNoticesToAdmins } from '../infrastructure/notifications/AccountNoticesToAdmins.js';
import { MultiChannelNotifier } from '../infrastructure/notifications/MultiChannelNotifier.js';
import { OutboxEmailChannel } from '../infrastructure/notifications/OutboxEmailChannel.js';
import { SmtpLoopbackTransport } from '../infrastructure/notifications/SmtpLoopbackTransport.js';
import { DeliverNowOrQueue } from '../application/maintenance/DeliverNowOrQueue.js';
import type { MailOutboxPort } from '../application/maintenance/MailOutboxPort.js';
import { SqliteMailOutbox } from '../infrastructure/persistence/SqliteMailOutbox.js';
import { SqliteMysbDumpSource } from '../infrastructure/persistence/SqliteMysbDumpSource.js';
import { SqliteMediaRepository } from '../infrastructure/persistence/SqliteMediaRepository.js';
import { SqliteDiagnosticsRepository } from '../infrastructure/persistence/SqliteDiagnosticsRepository.js';
import { SqliteSpeedtestRepository } from '../infrastructure/persistence/SqliteSpeedtestRepository.js';
import {
  DEFAULT_HOST_PRIVATE_KEY,
  DEFAULT_HOST_PUBLIC_KEY,
  FsHostKeyPair,
} from '../infrastructure/system/HostKeyPair.js';
import type { JobQueuePort } from '../application/jobs/JobQueuePort.js';
import { FsMediaScanner } from '../infrastructure/system/FsMediaScanner.js';
import { FsConfigFileReader } from '../infrastructure/system/FsConfigFileReader.js';
import { JournaldLogAdapter } from '../infrastructure/system/JournaldLogAdapter.js';
import { AptUpdateAdapter } from '../infrastructure/system/AptUpdateAdapter.js';
import { LibrespeedAdapter } from '../infrastructure/system/LibrespeedAdapter.js';
import { NtfyChannel } from '../infrastructure/notifications/NtfyChannel.js';
import type {
  NotificationChannel,
  NotificationContext,
} from '../infrastructure/notifications/formatEvent.js';
import type { SecurityNotificationPort } from '../domain/security/ports.js';
import type { TrackerNotificationPort } from '../domain/tracker/ports.js';
import type { NotificationPort, PasswordSealerPort } from '../domain/user/ports.js';
import { ComponentName } from '../domain/installation/ComponentName.js';
import { NextcloudLogin } from '../application/user/NextcloudLogin.js';
import {
  InviteMember,
  RequestPasswordReset,
  SendPasswordLink,
  SetPasswordFromLink,
  type PasswordLinkDeps,
  type PortalAddressPort,
} from '../application/portal/PasswordLinks.js';
import { SqlitePasswordLinkRepository } from '../infrastructure/persistence/SqlitePasswordLinkRepository.js';
import { WhenInstalled } from '../application/user/WhenInstalled.js';
import { RsaPasswordCipher } from '../infrastructure/system/RsaPasswordCipher.js';
import { SmbpasswdLogin } from '../infrastructure/system/SmbpasswdLogin.js';
import { RutorrentProfileAdapter } from '../infrastructure/system/RutorrentProfileAdapter.js';
import { KoboxDatabase } from '../infrastructure/persistence/db.js';
import { SqliteBlocklistRepository } from '../infrastructure/persistence/SqliteBlocklistRepository.js';
import { SqliteJobQueue } from '../infrastructure/persistence/SqliteJobQueue.js';
import { SqliteLoginAttemptsRepository } from '../infrastructure/persistence/SqliteLoginAttemptsRepository.js';
import { SiteSettingsWithInstallDefault } from '../infrastructure/persistence/SiteSettingsWithInstallDefault.js';
import { subnetOf } from '../domain/security/vpn.js';
import { SqliteSiteSettingsRepository } from '../infrastructure/persistence/SqliteSiteSettingsRepository.js';
import { SqliteMailRelayRepository } from '../infrastructure/persistence/SqliteMailRelayRepository.js';
import { SqliteSshKeyRepository } from '../infrastructure/persistence/SqliteSshKeyRepository.js';
import { AuthorizedKeysAdapter } from '../infrastructure/system/AuthorizedKeysAdapter.js';
import { SqliteDiskUsageRepository } from '../infrastructure/persistence/SqliteDiskUsageRepository.js';
import { SqlitePortalCredentialsRepository } from '../infrastructure/persistence/SqlitePortalCredentialsRepository.js';
import { SqlitePortalSessionRepository } from '../infrastructure/persistence/SqlitePortalSessionRepository.js';
import { SqlitePortAllocator } from '../infrastructure/persistence/SqlitePortAllocator.js';
import { SqliteTorrentInstanceRepository } from '../infrastructure/persistence/SqliteTorrentInstanceRepository.js';
import { SqliteSyncDestinationRepository } from '../infrastructure/persistence/SqliteSyncDestinationRepository.js';
import { AuthenticateApp } from '../application/portal/AuthenticateApp.js';
import { IssueAppToken } from '../application/portal/IssueAppToken.js';
import { CryptoSessionTokens } from '../infrastructure/system/CryptoSessionTokens.js';
import { SqliteSyncTransferRepository } from '../infrastructure/persistence/SqliteSyncTransferRepository.js';
import { RsyncOverSshTransfer } from '../infrastructure/system/RsyncOverSshTransfer.js';
import { FsLocalFileFacts } from '../infrastructure/system/FsLocalFileFacts.js';
import { RutorrentQuotaGauges } from '../infrastructure/system/RutorrentQuotaGauges.js';
import { RsaRemotePasswordCipher } from '../infrastructure/system/RsaRemotePasswordCipher.js';
import { SaveMailRelay } from '../application/maintenance/ConfigureMailRelay.js';
import { SetSyncDestination } from '../application/sync/SetSyncDestination.js';
import { SshRemoteProbe } from '../infrastructure/system/SshRemoteProbe.js';
import { ContentRecyclerAdapter } from '../infrastructure/system/ContentRecyclerAdapter.js';
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
  buildMaintenanceUseCases,
  buildSyncUseCases,
  buildSecurityUseCases,
  buildTorrentUseCases,
  buildTrackerUseCases,
  buildUseCases,
  type MaintenanceUseCases,
  type SecurityUseCases,
  type SyncUseCases,
  type TorrentUseCases,
  type TrackerUseCases,
  type UseCases,
} from './useCases.js';
import type { SecuritySettings } from '../application/security/settings.js';
import { mergeKoboxEnv, parseEnvFile } from './envSnapshot.js';
import { artifactPinsFrom } from './artifactPins.js';

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

// The host key pair, wherever this box keeps it: one place reads the override
// so every cipher built here seals and opens with the same pair. The override
// names keep the "DEBRID" the pair was first made for: a box that set one would
// otherwise fall back to the default path, where the installer mints a new pair
// and orphans every value sealed with the old one.
function hostKeyPair(): { readonly publicKey: string; readonly privateKey: string } {
  return {
    publicKey: process.env.KOBOX_DEBRID_PUBLIC_KEY ?? DEFAULT_HOST_PUBLIC_KEY,
    privateKey: process.env.KOBOX_DEBRID_PRIVATE_KEY ?? DEFAULT_HOST_PRIVATE_KEY,
  };
}

function hostKeyFiles(): FsHostKeyPair {
  const keys = hostKeyPair();
  return new FsHostKeyPair(keys.publicKey, keys.privateKey);
}

function passwordCipher(): RsaPasswordCipher {
  const keys = hostKeyPair();
  return new RsaPasswordCipher(keys.publicKey, keys.privateKey);
}

function remotePasswordCipher(): RsaRemotePasswordCipher {
  const keys = hostKeyPair();
  return new RsaRemotePasswordCipher(keys.publicKey, keys.privateKey);
}

// What an admin set in the interface wins over the environment: the screen is
// the newer, discoverable way to say it, and KOBOX_LE_* stays valid for anyone
// who already scripted an install.
// What an admin stored under Domain, else what the box was installed with.
function siteSettings(db: KoboxDatabase): SiteSettingsWithInstallDefault {
  const domain = process.env.KOBOX_LE_DOMAIN;
  const email = process.env.KOBOX_LE_EMAIL;
  return new SiteSettingsWithInstallDefault(
    new SqliteSiteSettingsRepository(db),
    domain !== undefined && domain !== '' && email !== undefined && email !== ''
      ? { domain, email }
      : undefined,
  );
}

// Where a member reaches the portal, for the links in their mail: the public
// domain on the standard https port, or this machine's name before there is one.
function portalAddress(db: KoboxDatabase): PortalAddressPort {
  return {
    baseUrl: async () =>
      `https://${(await siteSettings(db).get())?.domain ?? hostname()}`,
  };
}

export function nowStamp(): string {
  return stampOf(new Date());
}

// The operator's alert address as an address, when it is one: an admin with
// that same address is not mailed twice.
function alertAddress(raw: string | undefined): EmailAddress | undefined {
  try {
    return raw === undefined || raw === '' ? undefined : EmailAddress.parse(raw);
  } catch {
    return undefined;
  }
}

// Every mail goes to the local relay as it is written, and to the outbox only
// when the relay did not take it (see DeliverNowOrQueue).
function mailOutbox(db: KoboxDatabase): MailOutboxPort {
  return new DeliverNowOrQueue(new SqliteMailOutbox(db), new SmtpLoopbackTransport());
}

// The frozen alert channels (ntfy + email via Postfix + Discord), each armed
// by its env var; with none configured the Phase 0 console stub remains.
// Email is durable since Phase 5: alerts land in the mails outbox and the
// scheduled send-mails job flushes them through the relay.
function buildNotifier(
  logger: Logger,
  outbox: MailOutboxPort,
  db: KoboxDatabase,
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
  const context = async (): Promise<NotificationContext> => {
    // the box is named the way its members reach it
    const portalUrl = await portalAddress(db).baseUrl();
    return { box: new URL(portalUrl).host, portalUrl, at: nowStamp() };
  };
  const operator =
    channels.length > 0
      ? new MultiChannelNotifier(channels, logger, context)
      : new ConsoleNotificationAdapter(logger);
  const alreadyMailed = alertAddress(email);
  return new AccountNoticesToAdmins({
    operator,
    users: new SqliteUserRepository(db),
    credentials: new SqlitePortalCredentialsRepository(db),
    outbox,
    context,
    now: nowStamp,
    ...(alreadyMailed !== undefined && { alreadyMailed }),
  });
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
const WORKER_ENV_PATH = '/etc/kobox/worker.env';

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
  const quotaFs = process.env.KOBOX_QUOTA_FS;
  const site = await siteSettings(c.db).get();
  const leDomain = site?.domain;
  const leEmail = site?.email;
  const acmeUrl = process.env.KOBOX_ACME_URL;
  const installPki = new EasyRsaPkiAdapter(runner, process.env.KOBOX_VPN_PKI ?? DEFAULT_PKI_DIR);
  const ctx: InstallerContext = {
    packages: new AptPackageAdapter(runner),
    files: new RtorrentConfigAdapter(runner),
    systemd: new SystemdAdapter(runner),
    checks: new ConfigCheckAdapter(runner),
    host: new InstallHostAdapter(runner),
    ipset: new IpsetAdapter(runner),
    hostKeys: hostKeyFiles(),
    certbot: new CertbotAdapter(runner, process.env.KOBOX_ACME_CA_BUNDLE),
    pki: installPki,
    pkiProvision: installPki,
    artifacts: new ArtifactFetchAdapter(defaultBodyFetcher()),
    facts,
    security: securitySettings(),
    nextcloud: new OccNextcloudAdapter(runner),
    install: {
      nodeBin: process.execPath,
      dbPath: process.env.KOBOX_DB ?? DEFAULT_DB_PATH,
      // the package root of the RUNNING build (contains dist/, node_modules)
      sourceDir: fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, ''),
      currentLink: process.env.KOBOX_CURRENT_LINK ?? DEFAULT_CURRENT_LINK,
      koboxBin: process.env.KOBOX_BIN ?? DEFAULT_KOBOX_BIN,
      manageAptSources: flags.manageAptSources,
      // every vendored release's pin, from one tested place
      ...artifactPinsFrom(process.env),
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
      // merged with what a previous install wrote, so re-running from a plain
      // shell converges rather than wiping the box's configuration
      workerEnv: mergeKoboxEnv(
        parseEnvFile(await readFile(WORKER_ENV_PATH, 'utf8').catch(() => undefined)),
        koboxEnvSnapshot(),
      ),
    },
  };
  const installers = buildInstallers(ctx);
  const registry = new SqliteComponentRegistry(c.db);
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
      now: nowStamp,
      onProgress,
    }),
    uninstall: new UninstallComponents({
      registry,
      installers,
      catalog: COMPONENT_CATALOG,
      now: nowStamp,
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
  readonly saveMailRelay: SaveMailRelay;
  readonly inviteMember: InviteMember;
  readonly outbox: MailOutboxPort;
  readonly syncUseCases: SyncUseCases;
  readonly setDestination: SetSyncDestination;
  readonly speedtestRepo: SqliteSpeedtestRepository;
  readonly diagnosticsRepo: SqliteDiagnosticsRepository;
  readonly mediaRepo: SqliteMediaRepository;
  readonly queue: SqliteJobQueue;
  readonly worker: JobWorker;
  // seals a password typed at the CLI for the worker, like the portal does
  readonly passwords: RsaPasswordCipher;
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

// ---------------------------------------------------------------------------
// The portal's OWN wiring (Phase 8 §B.1).
//
// It builds the repositories it reads, the queue it enqueues into, and nothing
// else: no JobWorker, no privileged adapter, no use case that mutates the host.
// The non-root boundary stops being a promise about what the process *calls* and
// becomes a fact about what it can even construct.
//
// Two deliberate details:
//   - `passwords` is typed as the SEALER port only, so this container cannot
//     open a sealed password even though one class implements both halves;
//   - a CommandRunner is still created, but only for openssl (password verify)
//     and the health probe — neither is privileged, and the process runs as
//     kobox-portal regardless.
export interface PortalContainer {
  readonly db: KoboxDatabase;
  readonly logger: Logger;
  readonly queue: JobQueuePort;
  readonly repo: SqliteUserRepository;
  readonly credentials: SqlitePortalCredentialsRepository;
  readonly sessions: SqlitePortalSessionRepository;
  readonly loginAttempts: SqliteLoginAttemptsRepository;
  readonly hasher: OpensslPasswordHasher;
  readonly trackerRepo: SqliteTrackerRepository;
  readonly blocklistRepo: SqliteBlocklistRepository;
  readonly addressRepo: SqliteUserAddressRepository;
  readonly fairUseRepo: SqliteFairUseRepository;
  readonly healthProbe: ProcessSocketHealthProbe;
  readonly componentRegistry: SqliteComponentRegistry;
  readonly releaseRepo: SqliteReleaseRepository;
  readonly speedtests: SqliteSpeedtestRepository;
  readonly diagnostics: SqliteDiagnosticsRepository;
  readonly configFiles: FsConfigFileReader;
  readonly authenticateApp: AuthenticateApp;
  readonly issueAppToken: IssueAppToken;
  readonly instances: SqliteTorrentInstanceRepository;
  readonly diskSamples: SqliteDiskUsageRepository;
  readonly mailRelay: SqliteMailRelayRepository;
  readonly siteSettings: SiteSettingsWithInstallDefault;
  readonly boxInVpn: string;
  readonly sshPort: number;
  readonly nextcloudSignsInFromPortal: boolean;
  readonly saveMailRelay: SaveMailRelay;
  readonly sshKeys: SqliteSshKeyRepository;
  readonly destinations: SqliteSyncDestinationRepository;
  readonly transfers: SqliteSyncTransferRepository;
  readonly setDestination: SetSyncDestination;
  readonly outbox: MailOutboxPort;
  // a member's new password goes to the worker sealed, and the portal can never
  // open one back
  readonly passwords: PasswordSealerPort;
  readonly media: SqliteMediaRepository;
  readonly inviteMember: InviteMember;
  readonly sendPasswordLink: SendPasswordLink;
  readonly requestPasswordReset: RequestPasswordReset;
  readonly setPasswordFromLink: SetPasswordFromLink;
}

// What invitations and forgotten passwords need, for the portal and the
// command line alike: mint the link, mail it, seal the chosen password for the
// worker.
function passwordLinkDeps(
  db: KoboxDatabase,
  stores: Pick<PasswordLinkDeps, 'users' | 'credentials' | 'outbox' | 'queue'>,
): PasswordLinkDeps {
  return {
    ...stores,
    links: new SqlitePasswordLinkRepository(db),
    passwords: passwordCipher(),
    tokens: new CryptoSessionTokens(),
    address: portalAddress(db),
    clock: nowStamp,
  };
}

export function buildPortalContainer(name: string): PortalContainer {
  const logger = createLogger(name);
  const db = KoboxDatabase.open(process.env.KOBOX_DB ?? DEFAULT_DB_PATH);
  const syncDestinations = new SqliteSyncDestinationRepository(db);
  const mailRelay = new SqliteMailRelayRepository(db);
  // openssl + health probe only; nothing here mutates the host
  const runner = new ExecFileRunner();
  const queue = new SqliteJobQueue(db);
  const portalCredentialsRepo = new SqlitePortalCredentialsRepository(db);
  const portalAttempts = new SqliteLoginAttemptsRepository(db);
  const users = new SqliteUserRepository(db);
  const outbox = mailOutbox(db);
  const linkDeps = passwordLinkDeps(db, {
    users,
    credentials: portalCredentialsRepo,
    outbox,
    queue,
  });
  return {
    db,
    logger,
    queue,
    repo: users,
    inviteMember: new InviteMember(linkDeps),
    sendPasswordLink: new SendPasswordLink(linkDeps),
    requestPasswordReset: new RequestPasswordReset({
      ...linkDeps,
      notifications: buildNotifier(logger, outbox, db),
    }),
    setPasswordFromLink: new SetPasswordFromLink(linkDeps),
    credentials: portalCredentialsRepo,
    sessions: new SqlitePortalSessionRepository(db),
    loginAttempts: portalAttempts,
    hasher: new OpensslPasswordHasher(runner),
    trackerRepo: new SqliteTrackerRepository(db),
    blocklistRepo: new SqliteBlocklistRepository(db),
    addressRepo: new SqliteUserAddressRepository(db),
    fairUseRepo: new SqliteFairUseRepository(db),
    healthProbe: new ProcessSocketHealthProbe(runner),
    componentRegistry: new SqliteComponentRegistry(db),
    releaseRepo: new SqliteReleaseRepository(db),
    speedtests: new SqliteSpeedtestRepository(db),
    // read-only from here: the portal displays captures, the worker makes them
    diagnostics: new SqliteDiagnosticsRepository(db),
    issueAppToken: new IssueAppToken({
      credentials: portalCredentialsRepo,
      tokens: new CryptoSessionTokens(),
      clock: nowStamp,
    }),
    // machines authenticate with a per-member token, never the account password
    authenticateApp: new AuthenticateApp({
      credentials: portalCredentialsRepo,
      attempts: portalAttempts,
      tokens: new CryptoSessionTokens(),
      clock: nowStamp,
    }),
    // world-readable files only, from a closed catalog: no privilege needed,
    // and no job either — a config screen must show what is on disk NOW
    configFiles: new FsConfigFileReader(),
    // read-only from the portal: it lists a member's folders, the worker is
    // what creates directories and changes a mode
    instances: new SqliteTorrentInstanceRepository(db),
    diskSamples: new SqliteDiskUsageRepository(db),
    mailRelay,
    siteSettings: siteSettings(db),
    // members reach Samba and NFS at the box's address in the usual tunnel
    boxInVpn: subnetOf('tun-gw', securitySettings().vpn).firstAddress(),
    sshPort: securitySettings().sshPort,
    // pinned, the nextcloud component installs it with Nextcloud itself
    nextcloudSignsInFromPortal: nextcloudSsoRelease(artifactPinsFrom(process.env)) !== undefined,
    // the PUBLIC half only: the portal and the CLI store a relay the same way
    saveMailRelay: new SaveMailRelay({ settings: mailRelay, sealer: remotePasswordCipher() }),
    passwords: passwordCipher(),
    sshKeys: new SqliteSshKeyRepository(db),
    destinations: syncDestinations,
    // read-only from here: the portal shows the queue, the worker moves it
    transfers: new SqliteSyncTransferRepository(db),
    // the PUBLIC half only: the portal can seal a password, never open one
    setDestination: new SetSyncDestination({
      destinations: syncDestinations,
      sealer: remotePasswordCipher(),
    }),
    outbox,
    media: new SqliteMediaRepository(db),
  };
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
  const outbox = mailOutbox(db);
  const notifications = buildNotifier(logger, outbox, db);
  const credentials = new SqlitePortalCredentialsRepository(db);
  const sessions = new SqlitePortalSessionRepository(db);
  const loginAttempts = new SqliteLoginAttemptsRepository(db);
  const nextcloud = new OccNextcloudAdapter(runner);
  const components = new SqliteComponentRegistry(db);
  const passwords = passwordCipher();
  const useCases = buildUseCases({
    repo,
    accounts: new SystemAccountAdapter(runner),
    quota,
    diskSamples: new SqliteDiskUsageRepository(db),
    // ruTorrent's disk meter shows each member their quota from these
    quotaGauges: new RutorrentQuotaGauges(new RtorrentConfigAdapter(runner)),
    nextcloud,
    components,
    outbox,
    hasher: new OpensslPasswordHasher(runner),
    links: new SqlitePasswordLinkRepository(db),
    // one password for every service: each one keeping its own copy is here
    logins: [
      new WhenInstalled(ComponentName.parse('samba'), components, new SmbpasswdLogin(runner)),
      new WhenInstalled(
        ComponentName.parse('nextcloud'),
        components,
        new NextcloudLogin({ nextcloud, credentials }),
      ),
    ],
    sshKeys: new SqliteSshKeyRepository(db),
    authorizedKeys: new AuthorizedKeysAdapter(runner, new RtorrentConfigAdapter(runner)),
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
    // kobox install honestly skips (dnscrypt-proxy where Debian does not
    // package it)
    strict: process.env.KOBOX_STRICT_SERVICES === '1',
    tolerateAbsent: ['dnscrypt-proxy'],
  });
  const mediaRepo = new SqliteMediaRepository(db);
  const torrentUseCases = buildTorrentUseCases({
    users: repo,
    outbox,
    recycler: new ContentRecyclerAdapter(runner),
    instances: new SqliteTorrentInstanceRepository(db),
    torrents: new SqliteTorrentRepository(db),
    config: new RtorrentConfigAdapter(runner),
    watchDirs: new WatchDirAdapter(runner),
    fileIndex: nextcloud,
    filing: new MvTorrentFiling(runner),
    services,
    metainfo: new BencodeMetainfoAdapter(),
    control: new ScgiRtorrentControlAdapter(),
    scripts: new UserScriptRunnerAdapter(runner),
    announcers: new EnqueueAnnouncerSink(queue),
    templates: loadRtorrentTemplates(),
    settings: { koboxBin: process.env.KOBOX_BIN ?? DEFAULT_KOBOX_BIN },
    nginx: networkServices,
    rutorrentProfiles: new RutorrentProfileAdapter(runner),
    rutorrentPools: new PhpFpmRutorrentPools(runner, new RtorrentConfigAdapter(runner)),
    mediaScanner: new FsMediaScanner(),
    media: mediaRepo,
    clock: nowStamp,
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
  const speedtestRepo = new SqliteSpeedtestRepository(db);
  const diagnosticsRepo = new SqliteDiagnosticsRepository(db);
  const mailRelay = new SqliteMailRelayRepository(db);
  const maintenanceUseCases = buildMaintenanceUseCases({
    outbox,
    transport: new SmtpLoopbackTransport(),
    backupHost: new BackupHostAdapter(runner, db),
    backupSettings: backupSettings(),
    speedtest: new LibrespeedAdapter(runner, process.env.KOBOX_SPEEDTEST_BIN),
    systemd: new SystemdAdapter(runner),
    speedtests: speedtestRepo,
    logs: new JournaldLogAdapter(runner),
    packageUpdates: new AptUpdateAdapter(runner),
    diagnostics: diagnosticsRepo,
    mailRelay,
    opener: remotePasswordCipher(),
    files: new RtorrentConfigAdapter(runner),
    installHost: new InstallHostAdapter(runner),
    clock: nowStamp,
  });
  const syncDestinationRepo = new SqliteSyncDestinationRepository(db);
  const syncTransferRepo = new SqliteSyncTransferRepository(db);
  const syncUseCases = buildSyncUseCases({
    users: repo,
    instances: new SqliteTorrentInstanceRepository(db),
    destinations: syncDestinationRepo,
    transfers: syncTransferRepo,
    outbox,
    transport: new RsyncOverSshTransfer(runner),
    facts: new FsLocalFileFacts(),
    torrents: new SqliteTorrentRepository(db),
    hour: () => new Date().getHours(),
    // the private half of the host key: root only, which is why this lives in
    // the worker container and not in the portal's
    opener: remotePasswordCipher(),
    probe: new SshRemoteProbe(runner),
    clock: nowStamp,
  });
  return {
    db,
    logger,
    useCases,
    syncUseCases,
    // root holds both halves; sealing still only needs the public one
    setDestination: new SetSyncDestination({
      destinations: syncDestinationRepo,
      sealer: remotePasswordCipher(),
    }),
    torrentUseCases,
    trackerUseCases,
    securityUseCases,
    maintenanceUseCases,
    saveMailRelay: new SaveMailRelay({ settings: mailRelay, sealer: remotePasswordCipher() }),
    // the same invitation the portal sends: nobody types the member's password
    inviteMember: new InviteMember(passwordLinkDeps(db, { users: repo, credentials, outbox, queue })),
    outbox,
    queue,
    worker: new JobWorker(
      queue,
      useCases,
      torrentUseCases,
      trackerUseCases,
      securityUseCases,
      maintenanceUseCases,
      syncUseCases,
      passwords,
    ),
    speedtestRepo,
    diagnosticsRepo,
    mediaRepo,
    passwords,
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
