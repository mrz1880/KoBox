import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJob, type Job } from '../../../src/application/jobs/contract.js';
import type { BackupHostPort } from '../../../src/application/maintenance/BackupHostPort.js';
import type { MailDelivery } from '../../../src/application/maintenance/MailTransportPort.js';
import { InMemoryMediaRepository } from '../../../src/infrastructure/persistence/InMemoryMediaRepository.js';
import { FakeSystemd } from '../../../src/infrastructure/system/fakes/FakeSystemd.js';
import { InMemorySyncTransferRepository } from '../../../src/infrastructure/persistence/InMemorySyncTransferRepository.js';
import { InMemorySyncDestinationRepository } from '../../../src/infrastructure/persistence/InMemorySyncDestinationRepository.js';
import { InMemoryDiagnosticsRepository } from '../../../src/infrastructure/persistence/InMemoryDiagnosticsRepository.js';
import { InMemorySpeedtestRepository } from '../../../src/infrastructure/persistence/InMemorySpeedtestRepository.js';
import type { ClaimedJob, JobQueuePort } from '../../../src/application/jobs/JobQueuePort.js';
import { InfoHash } from '../../../src/domain/torrent/InfoHash.js';
import { TorrentInstance } from '../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../src/domain/user/Port.js';
import { Quota } from '../../../src/domain/user/Quota.js';
import { InMemoryCleanupReportRepository } from '../../../src/infrastructure/persistence/InMemoryCleanupReportRepository.js';
import { InMemoryCleanupSnapshotRepository } from '../../../src/infrastructure/persistence/InMemoryCleanupSnapshotRepository.js';
import { InMemorySpacePreferenceRepository } from '../../../src/infrastructure/persistence/InMemorySpacePreferenceRepository.js';
import { SeedRule } from '../../../src/domain/space/SeedRule.js';
import { InMemorySeedRuleRepository } from '../../../src/infrastructure/persistence/InMemorySeedRuleRepository.js';
import { FakeMemberTorrents } from '../../../src/infrastructure/system/fakes/FakeMemberTorrents.js';
import { FakeTorrentData } from '../../../src/infrastructure/system/fakes/FakeTorrentData.js';
import { Label } from '../../../src/domain/torrent/Label.js';
import { Torrent } from '../../../src/domain/torrent/Torrent.js';
import { Password } from '../../../src/domain/user/Password.js';
import { Username } from '../../../src/domain/user/Username.js';
import { IpAddress } from '../../../src/domain/shared/IpAddress.js';
import { Blocklist } from '../../../src/domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../../src/domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../../src/domain/tracker/BlocklistUrl.js';
import { TrackerHost } from '../../../src/domain/tracker/TrackerHost.js';
import { InMemoryBlocklistRepository } from '../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryTorrentRepository } from '../../../src/infrastructure/persistence/InMemoryTorrentRepository.js';
import { InMemoryTrackerRepository } from '../../../src/infrastructure/persistence/InMemoryTrackerRepository.js';
import { InMemoryUserAddressRepository } from '../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { InMemoryPortalCredentialsRepository } from '../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryPortalSessionRepository } from '../../../src/infrastructure/persistence/InMemoryPortalSessionRepository.js';
import { InMemorySshKeyRepository } from '../../../src/infrastructure/persistence/InMemorySshKeyRepository.js';
import { InMemoryDiskUsageRepository } from '../../../src/infrastructure/persistence/InMemoryDiskUsageRepository.js';
import { InMemoryVolumeSampleRepository } from '../../../src/infrastructure/persistence/InMemoryVolumeSampleRepository.js';
import { InMemoryMailOutbox } from '../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryUserRepository } from '../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeBlocklistCache } from '../../../src/infrastructure/system/fakes/FakeBlocklistCache.js';
import { FakeBlocklistDownload } from '../../../src/infrastructure/system/fakes/FakeBlocklistDownload.js';
import { FakeCertStore } from '../../../src/infrastructure/system/fakes/FakeCertStore.js';
import { FakeDnsResolver } from '../../../src/infrastructure/system/fakes/FakeDnsResolver.js';
import { FakeIblocklistCatalog } from '../../../src/infrastructure/system/fakes/FakeIblocklistCatalog.js';
import { FakeIpset } from '../../../src/infrastructure/system/fakes/FakeIpset.js';
import { FakeNetworkServiceReload } from '../../../src/infrastructure/system/fakes/FakeNetworkServiceReload.js';
import { FakeTrackerCert } from '../../../src/infrastructure/system/fakes/FakeTrackerCert.js';
import { FakeAnnouncerSink } from '../../../src/infrastructure/system/fakes/FakeAnnouncerSink.js';
import { FakeNotifications } from '../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeQuota } from '../../../src/infrastructure/system/fakes/FakeQuota.js';
import { FakeVolume } from '../../../src/infrastructure/system/fakes/FakeVolume.js';
import { FakeInstallHost } from '../../../src/infrastructure/system/fakes/FakeInstallHost.js';
import { FakeQuotaGauges } from '../../../src/infrastructure/system/fakes/FakeQuotaGauges.js';
import { InMemoryMailRelayRepository } from '../../../src/infrastructure/persistence/InMemoryMailRelayRepository.js';
import type { RemotePasswordOpenerPort } from '../../../src/domain/sync/ports.js';
import { RemotePassword } from '../../../src/domain/sync/RemotePassword.js';
import { FakeRtorrentConfig } from '../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { FakeRtorrentControl } from '../../../src/infrastructure/system/fakes/FakeRtorrentControl.js';
import { FakeServiceControl } from '../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeSftp } from '../../../src/infrastructure/system/fakes/FakeSftp.js';
import { FakeSystemAccounts } from '../../../src/infrastructure/system/fakes/FakeSystemAccounts.js';
import { FakeTorrentMetainfo } from '../../../src/infrastructure/system/fakes/FakeTorrentMetainfo.js';
import { FakeUserScriptRunner } from '../../../src/infrastructure/system/fakes/FakeUserScriptRunner.js';
import { FakeWatchDirs } from '../../../src/infrastructure/system/fakes/FakeWatchDirs.js';
import { FakeFileIndex } from '../../../src/infrastructure/system/fakes/FakeFileIndex.js';
import { FakeRutorrentPools } from '../../../src/infrastructure/system/fakes/FakeRutorrentPools.js';
import { FakeTorrentFiling } from '../../../src/infrastructure/system/fakes/FakeTorrentFiling.js';
import { loadRtorrentTemplates } from '../../../src/infrastructure/templates/TemplateProvider.js';
import { Bandwidth } from '../../../src/domain/security/Bandwidth.js';
import { Cidr } from '../../../src/domain/security/Cidr.js';
import { DynDnsHost } from '../../../src/domain/security/DynDnsHost.js';
import { FairUsePolicy } from '../../../src/domain/security/FairUsePolicy.js';
import { InMemoryFairUseRepository } from '../../../src/infrastructure/persistence/InMemoryFairUseRepository.js';
import { FakeDynDnsResolver } from '../../../src/infrastructure/system/fakes/FakeDynDnsResolver.js';
import { FakeShaping } from '../../../src/infrastructure/system/fakes/FakeShaping.js';
import { FakeSshAuthLog } from '../../../src/infrastructure/system/fakes/FakeSshAuthLog.js';
import { FakeUsageMeter } from '../../../src/infrastructure/system/fakes/FakeUsageMeter.js';
import { FakeFirewallApply } from '../../../src/infrastructure/system/fakes/FakeFirewallApply.js';
import { FakeNetworkServices } from '../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeUserIdentity } from '../../../src/infrastructure/system/fakes/FakeUserIdentity.js';
import { FakeVpnPki } from '../../../src/infrastructure/system/fakes/FakeVpnPki.js';
import { buildJob } from '../../../src/interfaces/cli/buildJob.js';
import { DirectJobRunner } from '../../../src/interfaces/worker/DirectJobRunner.js';
import { JobWorker } from '../../../src/interfaces/worker/JobWorker.js';
import {
  buildMaintenanceUseCases,
  buildSpaceUseCases,
  buildSyncUseCases,
  buildSecurityUseCases,
  buildTorrentUseCases,
  buildTrackerUseCases,
  buildUseCases,
} from '../../../src/interfaces/useCases.js';
import { FakePasswordCipher } from '../../../src/infrastructure/system/fakes/FakePasswordCipher.js';
import { FakePasswordHasher } from '../../../src/infrastructure/system/fakes/FakePasswordHasher.js';
import { FakeServiceLogin } from '../../../src/infrastructure/system/fakes/FakeServiceLogin.js';
import { NextcloudLogin } from '../../../src/application/user/NextcloudLogin.js';
import { WhenInstalled } from '../../../src/application/user/WhenInstalled.js';
import { InMemoryPasswordLinkRepository } from '../../../src/infrastructure/persistence/InMemoryPasswordLinkRepository.js';
import { FakeRutorrentProfiles } from '../../../src/infrastructure/system/fakes/FakeRutorrentProfiles.js';
import { FakeNextcloud } from '../../../src/infrastructure/system/fakes/FakeNextcloud.js';
import { InMemoryComponentRegistry } from '../../../src/infrastructure/persistence/InMemoryComponentRegistry.js';
import { ComponentName } from '../../../src/domain/installation/ComponentName.js';
import { MEMBER_PORT_RESERVATION_PATH } from '../../../src/domain/installation/rendering.js';
import { FakeKernelSettings } from '../../../src/infrastructure/system/fakes/FakeKernelSettings.js';

class InMemoryJobQueue implements JobQueuePort {
  private readonly rows: { id: number; job: Job; status: string; error?: string }[] = [];
  private nextId = 1;

  enqueue(job: Job): Promise<number> {
    const id = this.nextId++;
    this.rows.push({ id, job, status: 'pending' });
    return Promise.resolve(id);
  }

  enqueueUnique(job: Job): Promise<number | undefined> {
    const payloadJson = JSON.stringify(job.payload);
    const existing = this.rows.find(
      (r) =>
        r.status === 'pending' &&
        r.job.type === job.type &&
        JSON.stringify(r.job.payload) === payloadJson,
    );
    if (existing) return Promise.resolve(undefined);
    return this.enqueue(job);
  }

  pendingTypes(): readonly string[] {
    return this.rows.filter((r) => r.status === 'pending').map((r) => r.job.type);
  }

  claimNextPending(): Promise<ClaimedJob | undefined> {
    const row = this.rows.find((r) => r.status === 'pending');
    if (!row) return Promise.resolve(undefined);
    row.status = 'running';
    return Promise.resolve({ id: row.id, job: row.job });
  }

  markDone(id: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = 'done';
    return Promise.resolve();
  }

  markFailed(id: number, error: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = 'failed';
      row.error = error;
    }
    return Promise.resolve();
  }

  statusOf(id: number): string | undefined {
    return this.rows.find((r) => r.id === id)?.status;
  }

  errorOf(id: number): string | undefined {
    return this.rows.find((r) => r.id === id)?.error;
  }

  recoverStale(): Promise<number> {
    const stale = this.rows.filter((r) => r.status === 'running');
    for (const row of stale) {
      row.status = 'failed';
      row.error = 'interrupted: worker restarted';
    }
    return Promise.resolve(stale.length);
  }
}

const alice = Username.parse('alice');

interface World {
  queue: InMemoryJobQueue;
  nextcloud: FakeNextcloud;
  components: InMemoryComponentRegistry;
  accounts: FakeSystemAccounts;
  services: FakeServiceControl;
  instances: InMemoryTorrentInstanceRepository;
  torrents: InMemoryTorrentRepository;
  scripts: FakeUserScriptRunner;
  trackers: InMemoryTrackerRepository;
  blocklists: InMemoryBlocklistRepository;
  dns: FakeDnsResolver;
  certPort: FakeTrackerCert;
  certStore: FakeCertStore;
  download: FakeBlocklistDownload;
  networkFiles: FakeRtorrentConfig;
  rutorrentFiles: FakeRtorrentConfig;
  blocklistCache: FakeBlocklistCache;
  firewall: FakeFirewallApply;
  identity: FakeUserIdentity;
  dyndns: FakeDynDnsResolver;
  pki: FakeVpnPki;
  ipset: FakeIpset;
  outbox: InMemoryMailOutbox;
  diagnostics: InMemoryDiagnosticsRepository;
  syncDestinations: InMemorySyncDestinationRepository;
  syncTransfers: InMemorySyncTransferRepository;
  memberTorrents: FakeMemberTorrents;
  cleanupReports: InMemoryCleanupReportRepository;
  spacePreferences: InMemorySpacePreferenceRepository;
  seedRule: InMemorySeedRuleRepository;
  quota: FakeQuota;
  mailTransport: RecordingMailTransport;
  backupHost: FakeBackupHost;
  // what the worker logged at warn level, context and message
  warnings: { context: unknown; message: string | undefined }[];
  worker: JobWorker;
  // what `kobox --direct` runs: the same deps, no shared queue
  direct: DirectJobRunner;
  passwords: FakePasswordCipher;
  samba: FakeServiceLogin;
  credentials: InMemoryPortalCredentialsRepository;
  kernel: FakeKernelSettings;
  kernelFiles: FakeRtorrentConfig;
}

class RecordingMailTransport {
  readonly delivered: MailDelivery[] = [];

  deliver(mail: MailDelivery): Promise<void> {
    this.delivered.push(mail);
    return Promise.resolve();
  }
}

class FakeBackupHost implements BackupHostPort {
  private readonly unarchivableHomes = new Set<string>();

  refusesToArchive(home: string): void {
    this.unarchivableHomes.add(home);
  }

  archiveTrees(baseDir: string): Promise<void> {
    return this.unarchivableHomes.has(baseDir)
      ? Promise.reject(new Error('tar: write error'))
      : Promise.resolve();
  }
  ensureDir(): Promise<void> {
    return Promise.resolve();
  }
  sqliteBackup(): Promise<void> {
    return Promise.resolve();
  }
  archiveDir(): Promise<boolean> {
    return Promise.resolve(true);
  }
  listBackups(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
  removeBackup(): Promise<void> {
    return Promise.resolve();
  }
  restoreDatabase(): Promise<string> {
    return Promise.reject(new Error('not under test'));
  }
}


// Opens what portalWorld's sealer produces. Reversible on purpose: this suite
// checks the wiring reaches the opener, not that a real seal is opaque.
class ReversibleSealOpener implements RemotePasswordOpenerPort {
  open(sealed: string): Promise<RemotePassword> {
    return Promise.resolve(RemotePassword.parse(sealed.replace(/^rsealed:/, '')));
  }
}

let world: World;

beforeEach(() => {
  const outbox = new InMemoryMailOutbox();
  const nextcloud = new FakeNextcloud();
  const samba = new FakeServiceLogin();
  const passwords = new FakePasswordCipher();
  const components = new InMemoryComponentRegistry();
  const repo = new InMemoryUserRepository();
  const accounts = new FakeSystemAccounts();
  const quota = new FakeQuota();
  const sftp = new FakeSftp();
  const services = new FakeServiceControl();
  const notifications = new FakeNotifications();
  let nextScgi = 51101;
  let nextRtorrent = 45000;
  const credentials = new InMemoryPortalCredentialsRepository();
  const sessions = new InMemoryPortalSessionRepository();
  const instances = new InMemoryTorrentInstanceRepository();
  const syncTransfers = new InMemorySyncTransferRepository();
  const diskSamples = new InMemoryDiskUsageRepository();
  const memberTorrents = new FakeMemberTorrents();
  const cleanupReports = new InMemoryCleanupReportRepository();
  const queue = new InMemoryJobQueue();
  const spacePreferences = new InMemorySpacePreferenceRepository();
  const seedRule = new InMemorySeedRuleRepository();
  const quotaGauges = new FakeQuotaGauges();
  const kernel = new FakeKernelSettings();
  const kernelFiles = new FakeRtorrentConfig();
  const spaceUseCases = buildSpaceUseCases({
    instances,
    torrents: memberTorrents,
    data: new FakeTorrentData(),
    transfers: syncTransfers,
    seedRule,
    snapshots: new InMemoryCleanupSnapshotRepository(),
    reports: cleanupReports,
    quota,
    samples: diskSamples,
    users: repo,
    gauges: quotaGauges,
    preferences: spacePreferences,
    queue,
    mail: {
      users: repo,
      credentials,
      address: { baseUrl: () => Promise.resolve('https://box.example.org') },
      outbox,
    },
    clock: () => '2026-07-25 10:00:00',
  });
  const useCases = buildUseCases({
    repo,
    accounts,
    quota,
    diskSamples,
    volume: new FakeVolume(),
    volumeSamples: new InMemoryVolumeSampleRepository(),
    quotaGauges,
    cleanupSnapshot: spaceUseCases.takeCleanupSnapshot,
    spaceWatch: spaceUseCases.watchMemberSpace,
    nextcloud,
    components,
    outbox,
    hasher: new FakePasswordHasher(),
    links: new InMemoryPasswordLinkRepository(),
    logins: [
      new WhenInstalled(ComponentName.parse('samba'), components, samba),
      new WhenInstalled(
        ComponentName.parse('nextcloud'),
        components,
        new NextcloudLogin({ nextcloud, credentials }),
      ),
    ],
    sshKeys: new InMemorySshKeyRepository(),
    authorizedKeys: { write: () => Promise.resolve(), clear: () => Promise.resolve() },
    sftp,
    services,
    notifications,
    credentials,
    sessions,
    clock: () => '2026-07-25 10:00:00',
    // the ledger holds exactly the ports of the members the repository knows
    portLedger: {
      listAllocated: async () =>
        (await repo.listAll()).flatMap((user) => [user.scgiPort, user.rtorrentPort]),
    },
    files: kernelFiles,
    kernel,
    allocator: {
      allocateScgiPort: () =>
        import('../../../src/domain/user/Port.js').then((m) => m.ScgiPort.parse(nextScgi++)),
      allocateRtorrentPort: () =>
        import('../../../src/domain/user/Port.js').then((m) => m.RtorrentPort.parse(nextRtorrent++)),
      releaseScgiPort: () => Promise.resolve(),
      releaseRtorrentPort: () => Promise.resolve(),
      claimScgiPort: () => Promise.resolve(),
      claimRtorrentPort: () => Promise.resolve(),
    },
  });
  const torrents = new InMemoryTorrentRepository();
  const scripts = new FakeUserScriptRunner();
  const rutorrentFiles = new FakeRtorrentConfig();
  const torrentUseCases = buildTorrentUseCases({
    users: repo,
    outbox: new InMemoryMailOutbox(),
    recycler: { replicate: () => Promise.resolve() },
    instances,
    torrents,
    config: rutorrentFiles,
    watchDirs: new FakeWatchDirs(),
    fileIndex: new FakeFileIndex(),
    filing: new FakeTorrentFiling(),
    services,
    metainfo: new FakeTorrentMetainfo(),
    control: new FakeRtorrentControl(),
    scripts,
    announcers: new FakeAnnouncerSink(),
    templates: loadRtorrentTemplates(),
    settings: { koboxBin: '/usr/local/bin/kobox' },
    nginx: new FakeNetworkServices(),
    rutorrentProfiles: new FakeRutorrentProfiles(),
    rutorrentPools: new FakeRutorrentPools(),
    mediaScanner: { scan: () => Promise.resolve([]) },
    media: new InMemoryMediaRepository(),
    clock: () => '2026-07-25 10:00:00',
  });
  const trackers = new InMemoryTrackerRepository();
  const blocklists = new InMemoryBlocklistRepository();
  const dns = new FakeDnsResolver();
  const certPort = new FakeTrackerCert();
  const certStore = new FakeCertStore();
  const download = new FakeBlocklistDownload();
  const networkFiles = new FakeRtorrentConfig();
  const addresses = new InMemoryUserAddressRepository();
  const blocklistCache = new FakeBlocklistCache();
  const ipset = new FakeIpset();
  const trackerUseCases = buildTrackerUseCases({
    trackers,
    blocklists,
    addresses,
    users: repo,
    instances,
    dns,
    certPort,
    certStore,
    download,
    catalog: new FakeIblocklistCatalog([]),
    cache: blocklistCache,
    files: networkFiles,
    reload: new FakeNetworkServiceReload(),
    ipset,
    notifications,
  });
  const firewall = new FakeFirewallApply();
  const identity = new FakeUserIdentity();

  const dyndns = new FakeDynDnsResolver();
  const pki = new FakeVpnPki();
  const securityUseCases = buildSecurityUseCases({
    users: repo,
    addresses,
    bindings: addresses,
    identity,
    firewall,
    files: networkFiles,
    reload: new FakeNetworkServices(),
    ipset,
    resolver: dyndns,
    pki,
    pkiProvision: pki,
    fairUse: new InMemoryFairUseRepository(),
    meter: new FakeUsageMeter(),
    authLog: new FakeSshAuthLog(),
    shaping: new FakeShaping(),
    health: {
      checkProcess: (name) => Promise.resolve({ name, state: 'healthy' as const }),
      checkSocket: (host, port) =>
        Promise.resolve({ name: `${host}:${String(port)}`, state: 'healthy' as const }),
    },
    policy: FairUsePolicy.of({
      sustainedEgress: Bandwidth.mbit(50),
      maxAuthPerHour: 30,
      throttleTo: Bandwidth.mbit(5),
    }),
    notifications,
    settings: {
      sshPort: 22,
      portalPort: 8189,
      vpnRemote: DynDnsHost.parse('seedbox.example.org'),
      vpn: {
        tunGwPort: 8193,
        tunPort: 8194,
        tapPort: 8195,
        tunGwSubnet: Cidr.parse('10.0.0.0/24'),
        tunSubnet: Cidr.parse('10.0.1.0/24'),
        tapSubnet: Cidr.parse('10.0.2.0/24'),
      },
    },
  });
  const diagnosticsRepo = new InMemoryDiagnosticsRepository();
  const syncDestinations = new InMemorySyncDestinationRepository();
  const syncUseCases = buildSyncUseCases({
    users: repo,
    instances,
    destinations: syncDestinations,
    transfers: syncTransfers,
    outbox,
    transport: { send: () => Promise.resolve({ ok: true }) },
    facts: { isDirectory: () => Promise.resolve(false), exists: () => Promise.resolve(true) },
    torrents,
    hour: () => 2,
    // the sealed blob is opaque here: this suite proves the worker asks, not
    // that RSA works — that is the cipher's own test
    opener: { open: () => Promise.resolve(RemotePassword.parse('from-the-seal')) },
    probe: { probe: () => Promise.resolve({ ok: true, detail: 'the machine answered' }) },
    clock: () => '2026-07-25 10:00:00',
  });
  const mailTransport = new RecordingMailTransport();
  const backupHost = new FakeBackupHost();
  const maintenanceUseCases = buildMaintenanceUseCases({
    outbox,
    transport: mailTransport,
    backupHost,
    users: repo,
    backupSettings: { root: '/var/backups/kobox', ttlDays: 7, keepMin: 3, configDirs: [] },
    speedtest: { measure: () => Promise.reject(new Error('no speedtest in this suite')) },
    speedtests: new InMemorySpeedtestRepository(),
    systemd: new FakeSystemd(),
    logs: { tail: (service) => Promise.resolve(`journal for ${service.value}`) },
    packageUpdates: {
      listUpgradable: () => Promise.resolve({ listing: 'nginx/stable 1.2 upgradable from 1.1', count: 1 }),
      upgradeAll: () => Promise.resolve('1 upgraded'),
    },
    diagnostics: diagnosticsRepo,
    mailRelay: new InMemoryMailRelayRepository(),
    opener: new ReversibleSealOpener(),
    files: new FakeRtorrentConfig(),
    installHost: new FakeInstallHost(),
    clock: () => '2026-07-25 10:00:00',
  });
  const warnings: World['warnings'] = [];
  const workerDeps = {
    useCases,
    torrents: torrentUseCases,
    trackers: trackerUseCases,
    security: securityUseCases,
    maintenance: maintenanceUseCases,
    sync: syncUseCases,
    space: spaceUseCases,
    passwords,
    logger: {
      warn: (context: unknown, message?: string) => warnings.push({ context, message }),
    },
  };
  world = {
    kernel,
    kernelFiles,
    nextcloud,
    components,
    credentials,
    queue,
    accounts,
    services,
    instances,
    torrents,
    scripts,
    trackers,
    blocklists,
    dns,
    certPort,
    certStore,
    download,
    networkFiles,
    rutorrentFiles,
    blocklistCache,
    firewall,
    identity,
    dyndns,
    pki,
    passwords,
    samba,
    ipset,
    outbox,
    mailTransport,
    backupHost,
    diagnostics: diagnosticsRepo,
    syncDestinations,
    syncTransfers,
    memberTorrents,
    cleanupReports,
    spacePreferences,
    seedRule,
    quota,
    warnings,
    worker: new JobWorker({ ...workerDeps, queue }),
    direct: new DirectJobRunner(workerDeps),
  };
});

function createAliceJob(): Promise<Job> {
  return buildJob.createUser(
    {
      username: 'alice',
      email: 'alice@example.org',
      quotaGib: 412,
      proxyPort: 8080,
    },
    Password.parse('s3cretpw'),
    world.passwords,
  );
}

async function enqueueCreateAlice(): Promise<number> {
  return world.queue.enqueue(await createAliceJob());
}

describe('CLI enqueue -> root worker loop (the privilege seam)', () => {
  it('should_create_a_user_end_to_end_through_a_typed_job', async () => {
    const id = await enqueueCreateAlice();

    const processed = await world.worker.processNext();

    expect(processed).toBe(true);
    expect(world.queue.statusOf(id)).toBe('done');
    expect(await world.accounts.accountExists(alice)).toBe(true);
    // provisioning is a separate chained job: not yet executed after one step
    expect(await world.services.isUserServiceRunning(alice)).toBe(false);
  });

  // the portal's invitation is the member's first mail: a second one from the
  // worker would arrive alongside it, saying less
  it('should_leave_the_member_their_invitation_as_the_only_mail', async () => {
    await enqueueCreateAlice();

    await world.worker.drain();

    const recent = await world.outbox.listRecent(10);
    expect(recent.filter((mail) => mail.recipient === 'alice@example.org')).toEqual([]);
  });

  it('should_chain_the_user_blocklist_filter_render_after_provisioning', async () => {
    // Phase 2 debt: a new user gets their filter immediately, without
    // waiting for the next update-blocklists run (legacy parity).
    await world.blocklistCache.write(['10.0.0.0/8']);
    await enqueueCreateAlice();

    await world.worker.drain();

    expect(world.networkFiles.contentAt('/home/alice/blocklist/blocklist_rtorrent.txt')).toBe(
      '10.0.0.0/8\n',
    );
    expect(
      world.networkFiles.contentAt('/home/alice/rtorrent/config.d/80-blocklist.rc'),
    ).toContain('ipv4_filter.load');
  });

  it('should_chain_rtorrent_provisioning_after_create_user', async () => {
    await enqueueCreateAlice();

    await world.worker.drain();

    expect(await world.instances.findByUsername(alice)).toBeDefined();
    expect(world.services.unitContentFor(alice)).toContain('User=alice');
    expect(await world.services.isUserServiceRunning(alice)).toBe(true);
  });

  it('should_give_a_new_member_their_nextcloud_account_without_anyone_asking', async () => {
    // rTorrent and the VPN are provisioned on the same seam; leaving Nextcloud
    // to a button means a member without one until somebody remembers
    await world.components.markInstalled(ComponentName.parse('nextcloud'), undefined, '2026-08-17 12:00:00');
    await enqueueCreateAlice();

    await world.worker.drain();

    // with the password the member signs in to the portal with, not one of its own
    expect(world.nextcloud.passwordOf(alice)).toBe('s3cretpw');
    expect(world.nextcloud.mounts.map((m) => m.label)).toEqual([
      'rTorrent Complete',
      'rTorrent Torrents',
      'rTorrent Watch',
    ]);
  });

  it('should_do_nothing_at_all_when_nextcloud_is_not_installed', async () => {
    // the component skips without a pinned archive, and a member must not be
    // mailed a password for an account that does not exist
    await enqueueCreateAlice();

    await world.worker.drain();

    expect(world.nextcloud.users).toEqual([]);
    const mails = await world.outbox.listRecent(10);
    expect(mails.some((m) => m.subject.includes('Nextcloud'))).toBe(false);
  });

  it('should_delete_the_nextcloud_account_when_the_member_is_deleted', async () => {
    // deleting a member removes their home with userdel -r, so a surviving
    // Nextcloud account would be an orphan holding data nobody can reach
    await world.components.markInstalled(ComponentName.parse('nextcloud'), undefined, '2026-08-17 12:00:00');
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(buildJob.deleteUser({ username: 'alice' }));

    await world.worker.drain();

    expect(world.nextcloud.deleted).toContain('alice');
  });

  it('should_reserve_a_new_members_ports_before_their_rtorrent_first_starts', async () => {
    await enqueueCreateAlice();

    await world.worker.processNext();

    expect(world.queue.pendingTypes()[0]).toBe('reserve-member-ports');
    await world.worker.drain();
    expect(world.kernelFiles.contentAt(MEMBER_PORT_RESERVATION_PATH)).toContain(
      'net.ipv4.ip_local_reserved_ports = 45000,51101',
    );
    expect(world.kernel.loaded).toEqual([MEMBER_PORT_RESERVATION_PATH]);
  });

  it('should_hand_a_deleted_members_ports_back_to_the_kernel', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(buildJob.deleteUser({ username: 'alice' }));

    await world.worker.drain();

    const lines = world.kernelFiles.contentAt(MEMBER_PORT_RESERVATION_PATH)?.split('\n');
    expect(lines).toContain('net.ipv4.ip_local_reserved_ports =');
    expect(world.kernel.loaded).toHaveLength(2);
  });

  it('should_chain_deprovisioning_after_delete_user', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(buildJob.deleteUser({ username: 'alice' }));

    await world.worker.drain();

    expect(await world.instances.findByUsername(alice)).toBeUndefined();
    expect(world.services.unitContentFor(alice)).toBeUndefined();
  });

  it('should_chain_vpn_material_and_openvpn_render_after_create_user', async () => {
    // Phase 3 debt #2: a new user gets a client cert and rendered profiles
    await enqueueCreateAlice();

    await world.worker.drain();

    expect(world.pki.ensuredClients).toEqual(['alice']);
    expect(
      world.networkFiles.contentAt('/etc/kobox/vpn-profiles/alice/kobox-tun-gw.ovpn'),
    ).toContain('remote seedbox.example.org 8193');
  });

  it('should_remove_vpn_material_after_delete_user', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(buildJob.deleteUser({ username: 'alice' }));

    await world.worker.drain();

    expect(await world.pki.clientMaterial(alice)).toBeUndefined();
  });

  it('should_execute_a_torrent_event_job_end_to_end', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(
      parseJob('torrent-event', {
        username: 'alice',
        event: 'finished',
        infoHash: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
        name: 'x',
        basePath: '/home/alice/rtorrent/complete/x',
        directory: '/home/alice/rtorrent/complete',
      }),
    );

    await world.worker.drain();

    const torrent = await world.torrents.findByInfoHash(
      alice,
      InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'),
    );
    expect(torrent?.state.value).toBe('completed');
    expect(world.scripts.runs).toHaveLength(1);
  });

  it('should_execute_flag_and_watch_dir_jobs', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(parseJob('set-sync-disabled', { username: 'alice', disabled: true }));
    await world.queue.enqueue(parseJob('add-watch-dir', { username: 'alice', label: 'films' }));

    await world.worker.drain();

    const instance = await world.instances.findByUsername(alice);
    expect(instance?.syncDisabled).toBe(true);
    expect(instance?.watchDirs.map((dir) => dir.label?.value)).toEqual([undefined, 'films']);
  });

  // systemd refuses a sixth start within ten seconds: a member (or an admin)
  // adding several folders in a row must cost one restart, not one each
  it('should_restart_rtorrent_once_for_a_burst_of_new_folders', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    const before = world.services.restartsFor(alice);
    for (const label of ['Films', 'Series', 'Jeux', 'Divers', 'Apps', 'Ebooks', 'Musiques']) {
      await world.queue.enqueue(parseJob('add-watch-dir', { username: 'alice', label }));
    }

    await world.worker.drain();

    expect(world.services.restartsFor(alice) - before).toBe(1);
    const instance = await world.instances.findByUsername(alice);
    expect(instance?.watchDirs.filter((dir) => dir.label !== undefined)).toHaveLength(7);
  });

  it('should_rename_then_remove_a_folder_and_render_what_is_left', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(parseJob('add-watch-dir', { username: 'alice', label: 'Divers' }));
    await world.queue.enqueue(parseJob('add-watch-dir', { username: 'alice', label: 'Films' }));
    await world.worker.drain();
    const before = world.services.restartsFor(alice);

    await world.queue.enqueue(
      parseJob('rename-watch-dir', { username: 'alice', label: 'Divers', to: 'Docs' }),
    );
    await world.queue.enqueue(parseJob('remove-watch-dir', { username: 'alice', label: 'Films' }));
    await world.worker.drain();

    const instance = await world.instances.findByUsername(alice);
    expect(instance?.watchDirs.map((dir) => dir.label?.value)).toEqual([undefined, 'Docs']);
    // the folder rTorrent watches has to follow: one render for both
    expect(world.services.restartsFor(alice) - before).toBe(1);
  });

  it('should_send_what_a_folder_already_holds_once_asked', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(parseJob('add-watch-dir', { username: 'alice', label: 'Films' }));
    await world.worker.drain();
    await world.torrents.upsert(
      alice,
      Torrent.load({
        infoHash: InfoHash.parse('e'.repeat(40)),
        name: 'Old.Film.mkv',
        label: Label.parse('Films'),
      }).complete('/home/alice/rtorrent/complete/Films/Old.Film.mkv'),
    );
    await world.queue.enqueue(
      parseJob('set-category-sync-mode', { username: 'alice', label: 'Films', mode: 'scheduled' }),
    );
    const id = await world.queue.enqueue(
      parseJob('queue-folder-backlog', { username: 'alice', label: 'Films' }),
    );

    await world.worker.drain();
    expect(world.queue.errorOf(id)).toBeUndefined();

    const waiting = await world.syncTransfers.listWaiting(alice);
    expect(waiting.map((transfer) => transfer.source.value)).toEqual([
      '/home/alice/rtorrent/complete/Films/Old.Film.mkv',
    ]);
  });

  it('should_suspend_then_resume_via_jobs', async () => {
    await enqueueCreateAlice();
    await world.queue.enqueue(buildJob.suspendUser({ username: 'alice' }));
    await world.queue.enqueue(buildJob.resumeUser({ username: 'alice' }));

    await world.worker.drain();

    expect(await world.accounts.isLocked(alice)).toBe(false);
    expect(await world.services.isUserServiceRunning(alice)).toBe(true);
  });

  it('should_promote_a_member_through_a_role_change_job', async () => {
    await enqueueCreateAlice();
    await world.queue.enqueue(buildJob.setUserRole({ username: 'alice', role: 'admin' }));

    await world.worker.drain();

    expect((await world.credentials.find(alice))?.role).toBe('admin');
  });

  it('should_mark_a_job_failed_with_its_error_and_keep_going', async () => {
    const id = await world.queue.enqueue(buildJob.suspendUser({ username: 'ghost' }));

    const processed = await world.worker.processNext();

    expect(processed).toBe(true);
    expect(world.queue.statusOf(id)).toBe('failed');
    expect(world.queue.errorOf(id)).toMatch(/ghost not found/);
  });

  it('should_report_nothing_to_do_on_an_empty_queue', async () => {
    expect(await world.worker.processNext()).toBe(false);
  });
});

// `kobox --direct` runs a job as root without the worker: what the worker
// would have chained after it must still happen, or the member is left half made
describe('direct mode (the CLI without the worker)', () => {
  it('should_provision_rtorrent_and_reserve_the_ports_of_a_member_created_directly', async () => {
    await world.direct.run(await createAliceJob());

    expect(await world.accounts.accountExists(alice)).toBe(true);
    expect(await world.services.isUserServiceRunning(alice)).toBe(true);
    expect(world.kernelFiles.contentAt(MEMBER_PORT_RESERVATION_PATH)).toContain(
      'net.ipv4.ip_local_reserved_ports = 45000,51101',
    );
    // nothing left behind for a worker that may not be running
    expect(world.queue.pendingTypes()).toEqual([]);
  });

  it('should_deprovision_rtorrent_and_free_the_ports_of_a_member_deleted_directly', async () => {
    await world.direct.run(await createAliceJob());

    await world.direct.run(buildJob.deleteUser({ username: 'alice' }));

    expect(await world.instances.findByUsername(alice)).toBeUndefined();
    expect(world.services.unitContentFor(alice)).toBeUndefined();
    const lines = world.kernelFiles.contentAt(MEMBER_PORT_RESERVATION_PATH)?.split('\n');
    expect(lines).toContain('net.ipv4.ip_local_reserved_ports =');
  });

  // the operator typed the command and waits for its verdict: a job that
  // failed must fail the command, not vanish into a queue nobody reads
  it('should_fail_with_the_error_of_a_job_that_failed', async () => {
    await expect(world.direct.run(buildJob.suspendUser({ username: 'ghost' }))).rejects.toThrow(
      /ghost not found/,
    );
  });
});

describe('security job chains (provision -> firewall)', () => {
  it('should_apply_the_firewall_after_provisioning_a_user', async () => {
    world.identity.setUid('alice', 1001);
    await enqueueCreateAlice();

    await world.worker.drain();

    const content = world.firewall.applied.at(-1)?.content ?? '';
    expect(content).toContain(':kobox-u-alice - [0:0]');
    expect(content).toContain('-m owner --uid-owner 1001');
  });

  it('should_render_the_per_user_rpc_mounts_after_provisioning', async () => {
    world.identity.setUid('alice', 1001);
    await enqueueCreateAlice();

    await world.worker.drain();

    const include = world.rutorrentFiles.contentAt('/etc/nginx/kobox.d/rutorrent-users.conf');
    expect(include).toContain('location = /RPC-ALICE');
  });

  it('should_render_nfs_exports_after_creating_a_user_with_a_trusted_address', async () => {
    world.identity.setUid('alice', 1001);
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(buildJob.addUserAddress({ username: 'alice', ipv4: '203.0.113.9' }));

    await world.worker.drain();

    const exports = world.networkFiles.contentAt('/etc/exports.d/kobox.exports');
    const options = 'rw,sync,no_subtree_check,all_squash,anonuid=1001,anongid=1001';
    expect(exports).toContain(`/home/alice 203.0.113.9(${options})`);
    expect(exports).toContain(`/home/alice 10.0.1.2(${options})`);
  });

  it('should_reapply_the_firewall_after_deprovisioning', async () => {
    world.identity.setUid('alice', 1001);
    await enqueueCreateAlice();
    await world.worker.drain();
    world.identity.clearUid('alice');
    await world.queue.enqueue(buildJob.deleteUser({ username: 'alice' }));

    await world.worker.drain();

    const content = world.firewall.applied.at(-1)?.content ?? '';
    expect(content).not.toContain('kobox-u-alice');
  });

  it('should_execute_a_standalone_apply_firewall_job', async () => {
    const id = await world.queue.enqueue(parseJob('apply-firewall', {}));

    await world.worker.drain();

    expect(world.queue.statusOf(id)).toBe('done');
    expect(world.firewall.applied).toHaveLength(1);
  });

  it('should_refresh_whitelist_firewall_and_fail2ban_when_a_dyndns_address_changes', async () => {
    world.identity.setUid('alice', 1001);
    await enqueueCreateAlice();
    await world.worker.drain();
    world.dyndns.setAnswer('dyn.example.org', IpAddress.parse('203.0.113.9'));
    await world.queue.enqueue(
      parseJob('add-user-hostname', { username: 'alice', hostname: 'dyn.example.org' }),
    );
    await world.queue.enqueue(parseJob('resolve-dyndns', {}));

    await world.worker.drain();

    expect(world.networkFiles.contentAt('/etc/fail2ban/jail.d/kobox.local')).toContain(
      '203.0.113.9',
    );
    expect(world.firewall.applied.at(-1)?.content).toContain(
      '-A INPUT -s 203.0.113.9 -m comment --comment "kobox:trusted:alice" -j ACCEPT',
    );
  });

  it('should_refresh_firewall_and_fail2ban_on_static_address_changes_too', async () => {
    // removing a compromised member IP must leave the LIVE firewall too,
    // not only allow.p2p (review I2)
    world.identity.setUid('alice', 1001);
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(
      parseJob('add-user-address', { username: 'alice', ipv4: '198.51.100.7' }),
    );
    await world.worker.drain();

    expect(world.firewall.applied.at(-1)?.content).toContain(
      '-A INPUT -s 198.51.100.7 -m comment --comment "kobox:trusted:alice" -j ACCEPT',
    );
    expect(world.networkFiles.contentAt('/etc/fail2ban/jail.d/kobox.local')).toContain(
      '198.51.100.7',
    );

    await world.queue.enqueue(
      parseJob('remove-user-address', { username: 'alice', ipv4: '198.51.100.7' }),
    );
    await world.worker.drain();

    expect(world.firewall.applied.at(-1)?.content).not.toContain('198.51.100.7');
    expect(world.networkFiles.contentAt('/etc/fail2ban/jail.d/kobox.local')).not.toContain(
      '198.51.100.7',
    );
  });

  it('should_not_chain_refreshes_while_the_hostname_stays_unresolved', async () => {
    await world.queue.enqueue(
      parseJob('add-user-hostname', { username: 'alice', hostname: 'dyn.example.org' }),
    );
    await world.queue.enqueue(parseJob('resolve-dyndns', {}));

    await world.worker.drain();

    expect(world.firewall.applied).toHaveLength(0);
    expect(world.networkFiles.contentAt('/etc/bind/kobox.zones.blacklists')).toBeUndefined();
  });
});

describe('tracker job chains (discover -> cert -> whitelist, blocklists -> filters)', () => {
  it('should_chain_cert_fetch_and_whitelist_render_after_discovery', async () => {
    world.dns.givenAddresses('tracker.example.org', [IpAddress.parse('192.0.2.10')]);
    world.certPort.givenCert('tracker.example.org', { pem: 'PEM', expiresOn: '2026-09-15' });
    await world.queue.enqueue(
      parseJob('discover-tracker', {
        url: 'https://tracker.example.org/announce',
        privacy: 'private',
      }),
    );

    await world.worker.drain();

    const tracker = await world.trackers.findByHost(TrackerHost.parse('tracker.example.org'));
    expect(tracker?.isSsl).toBe(true);
    expect(world.certStore.installed.get('tracker.example.org')).toBe('PEM');
    // whitelist rendered: the ACTIVE tracker is absent from the DNS blacklist
    const zones = world.networkFiles.contentAt('/etc/bind/kobox.zones.blacklists');
    expect(zones).toBeDefined();
    expect(zones).not.toContain('tracker.example.org');
  });

  it('should_not_chain_anything_for_an_unresolvable_unknown_host', async () => {
    await world.queue.enqueue(
      parseJob('discover-tracker', {
        url: 'https://gone.example.net/announce',
        privacy: 'private',
      }),
    );

    await world.worker.drain();

    expect(world.certPort.fetchedHosts).toEqual([]);
    expect(world.networkFiles.contentAt('/etc/bind/kobox.zones.blacklists')).toBeUndefined();
  });

  it('should_trust_a_new_user_address_in_the_firewall', async () => {
    world.identity.setUid('alice', 1001);
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(
      parseJob('add-user-address', { username: 'alice', ipv4: '198.51.100.7' }),
    );

    await world.worker.drain();

    expect(world.firewall.applied.at(-1)?.content).toContain(
      '-A INPUT -s 198.51.100.7 -m comment --comment "kobox:trusted:alice" -j ACCEPT',
    );
  });

  it('should_chain_filter_rendering_after_a_blocklist_update', async () => {
    await enqueueCreateAlice();
    await world.worker.drain(); // create + provision chain
    await world.blocklists.save(
      Blocklist.create({
        source: BlocklistSource.parse('personal'),
        author: 'me',
        name: 'mine',
        url: BlocklistUrl.parse('https://lists.example.net/mine.gz'),
        subscription: false,
        enabled: true,
      }),
    );
    world.download.givenList('https://lists.example.net/mine.gz', {
      ranges: ['10.0.0.0/8'],
      sha256: 'aa',
    });
    await world.queue.enqueue(parseJob('update-blocklists', {}));

    await world.worker.drain();

    expect(world.networkFiles.contentAt('/home/alice/blocklist/blocklist_rtorrent.txt')).toBe(
      '10.0.0.0/8\n',
    );
    expect(
      world.networkFiles.contentAt('/home/alice/rtorrent/config.d/80-blocklist.rc'),
    ).toContain('ipv4_filter.load');
  });

  it('should_execute_renew_and_mark_dead_jobs', async () => {
    world.dns.givenAddresses('tracker.example.org', [IpAddress.parse('192.0.2.10')]);
    world.certPort.givenCert('tracker.example.org', { pem: 'PEM', expiresOn: '2026-09-15' });
    await world.queue.enqueue(
      parseJob('discover-tracker', {
        url: 'https://tracker.example.org/announce',
        privacy: 'private',
      }),
    );
    await world.worker.drain();

    await world.queue.enqueue(parseJob('mark-tracker-dead', { host: 'tracker.example.org' }));
    await world.worker.drain();

    const tracker = await world.trackers.findByHost(TrackerHost.parse('tracker.example.org'));
    expect(tracker?.isDead).toBe(true);
    expect(world.certStore.installed.size).toBe(0);
    expect(world.networkFiles.contentAt('/etc/bind/kobox.zones.blacklists')).toContain(
      'zone "tracker.example.org"',
    );
  });
});

describe('maintenance jobs', () => {
  it('should_flush_the_outbox_when_the_send_mails_job_runs', async () => {
    await world.outbox.enqueue(
      { recipient: 'admin@example.org', subject: 'KoBox alert', body: 'details' },
      '2026-07-25 10:00:00',
    );

    await world.queue.enqueue(parseJob('send-mails', {}));
    await world.worker.drain();

    expect(world.mailTransport.delivered).toHaveLength(1);
    expect(world.mailTransport.delivered[0]?.recipient).toBe('admin@example.org');
    expect((await world.outbox.listRecent(1))[0]?.status).toBe('sent');
  });
});

describe('ipset chain (blocklists -> kernel set)', () => {
  it('should_apply_the_ipset_after_a_blocklist_update', async () => {
    await world.blocklists.save(
      Blocklist.create({
        source: BlocklistSource.parse('personal'),
        author: 'me',
        name: 'mine',
        url: BlocklistUrl.parse('https://lists.example.net/mine.txt'),
        subscription: false,
        enabled: true,
      }),
    );
    world.download.givenList('https://lists.example.net/mine.txt', {
      ranges: ['192.0.2.0/24'],
      sha256: 'bb',
    });
    await world.queue.enqueue(parseJob('update-blocklists', {}));

    await world.worker.drain();

    expect(world.ipset.restored).toEqual(['/etc/kobox/blocklist.ipset']);
    expect(world.networkFiles.contentAt('/etc/kobox/blocklist.ipset')).toContain(
      'add kobox-bl-next 192.0.2.0/24',
    );
  });

  // an import that enables lists and stops there leaves the kernel set empty
  // until the next scheduled update, hours later
  it('should_download_the_lists_right_after_importing_the_catalog', async () => {
    await world.blocklists.save(
      Blocklist.create({
        source: BlocklistSource.parse('personal'),
        author: 'me',
        name: 'mine',
        url: BlocklistUrl.parse('https://lists.example.net/mine.txt'),
        subscription: false,
        enabled: true,
      }),
    );
    world.download.givenList('https://lists.example.net/mine.txt', {
      ranges: ['192.0.2.0/24'],
      sha256: 'bb',
    });
    await world.queue.enqueue(parseJob('import-blocklist-catalog', {}));

    await world.worker.drain();

    expect(world.ipset.restored).toEqual(['/etc/kobox/blocklist.ipset']);
  });

  it('should_render_but_not_load_when_the_kernel_lacks_ipset', async () => {
    world.ipset.supported = false;
    const id = await world.queue.enqueue(parseJob('apply-ipset', {}));

    await world.worker.drain();

    expect(world.queue.statusOf(id)).toBe('done'); // honest skip, not a failure
    expect(world.ipset.restored).toEqual([]);
    expect(world.networkFiles.contentAt('/etc/kobox/blocklist.ipset')).toContain('flush kobox-bl-next');
  });
});

describe('diagnostics jobs', () => {
  it('should_store_a_units_journal_when_capturing_its_log', async () => {
    await world.queue.enqueue(buildJob.captureServiceLog({ service: 'kobox-worker' }));

    await world.worker.drain();

    const snapshot = await world.diagnostics.findLog('kobox-worker');
    expect(snapshot?.content).toContain('journal for kobox-worker');
    expect(snapshot?.capturedAt).toBe('2026-07-25 10:00:00');
  });

  it('should_store_what_apt_reports_when_checking_for_updates', async () => {
    await world.queue.enqueue(buildJob.checkPackageUpdates());

    await world.worker.drain();

    const snapshot = await world.diagnostics.findPackages();
    expect(snapshot?.upgradableCount).toBe(1);
    expect(snapshot?.listing).toContain('nginx/stable');
  });

  it('should_refresh_the_listing_after_applying_so_the_screen_is_not_stale', async () => {
    // a listing left untouched after an upgrade would still advertise the
    // packages that were just installed
    await world.diagnostics.savePackages({
      listing: 'stale',
      upgradableCount: 99,
      checkedAt: '2026-07-20 08:00:00',
    });

    await world.queue.enqueue(buildJob.applyPackageUpdates());
    await world.worker.drain();

    const snapshot = await world.diagnostics.findPackages();
    expect(snapshot?.upgradableCount).toBe(1);
    expect(snapshot?.checkedAt).toBe('2026-07-25 10:00:00');
  });
});

describe('space jobs', () => {
  // the member only sees an older list; whoever looks after the box reads why
  it('should_log_a_member_whose_cleanup_list_could_not_be_refreshed', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    const instance = await world.instances.findByUsername(alice);
    if (instance === undefined) {
      throw new Error('alice was not given an rTorrent');
    }
    world.memberTorrents.goesDown(instance.scgiPort);
    const id = await world.queue.enqueue(parseJob('sample-disk-usage', {}));

    await world.worker.processNext();

    expect(world.queue.statusOf(id)).toBe('done');
    expect(world.warnings).toEqual([
      {
        context: {
          username: 'alice',
          cause: 'rtorrentSilent',
          error: `rtorrent SCGI on ${String(instance.scgiPort.value)} does not answer`,
        },
        message: 'space cleanup: list not refreshed',
      },
    ]);
  });

  it('should_mail_a_member_the_hourly_pass_finds_past_the_critical_line', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    world.quota.setUsageForTest(alice, Quota.gib(400));
    await world.queue.enqueue(parseJob('sample-disk-usage', {}));

    await world.worker.processNext();

    const mails = await world.outbox.listRecent(10);
    expect(mails.map((mail) => [mail.recipient, mail.subject])).toContainEqual([
      'alice@example.org',
      'Ta seedbox est presque pleine',
    ]);
  });

  // a member past the line may have missed their mail or their cleanup
  it('should_log_a_member_whose_space_could_not_be_watched', async () => {
    await enqueueCreateAlice();
    await world.worker.drain();
    vi.spyOn(world.spacePreferences, 'find').mockRejectedValue(new Error('database is locked'));
    const id = await world.queue.enqueue(parseJob('sample-disk-usage', {}));

    await world.worker.processNext();

    expect(world.queue.statusOf(id)).toBe('done');
    expect(world.warnings).toContainEqual({
      context: { username: 'alice', error: 'database is locked' },
      message: 'space watch: member not watched',
    });
  });

  it('should_delete_the_torrents_a_member_picked_and_report_it', async () => {
    const scgiPort = ScgiPort.parse(51101);
    await world.instances.save(
      TorrentInstance.provision({
        username: alice,
        scgiPort,
        rtorrentPort: RtorrentPort.parse(45000),
      }).instance,
    );
    const film = InfoHash.parse('A'.repeat(40));
    world.memberTorrents.holds(scgiPort, [
      {
        infoHash: film,
        name: 'Example Film',
        size: Quota.gib(12),
        ratio: 3,
        finishedAt: '2026-07-01T08:00:00.000Z',
        path: '/home/alice/rtorrent/complete/Films/Example Film',
      },
    ]);
    const id = await world.queue.enqueue(
      buildJob.cleanUpSpace({ username: 'alice', infoHashes: [film.value] }),
    );

    await world.worker.processNext();

    expect(world.queue.statusOf(id)).toBe('done');
    expect(world.memberTorrents.erased).toEqual([film.value]);
    expect((await world.cleanupReports.find(alice))?.freed.toGib()).toBe(12);
  });

  it('should_keep_what_a_member_lets_kobox_delete_on_its_own', async () => {
    const id = await world.queue.enqueue(
      buildJob.setAutomaticCleanup({ username: 'alice', scope: 'sentOnly' }),
    );

    await world.worker.processNext();

    expect(world.queue.statusOf(id)).toBe('done');
    expect((await world.spacePreferences.find(alice)).automatic).toBe('sentOnly');
  });

  it('should_keep_the_seed_rule_an_admin_set_for_the_whole_box', async () => {
    const id = await world.queue.enqueue(buildJob.setSeedRule({ ratio: 1.5, days: 14 }));

    await world.worker.processNext();

    expect(world.queue.statusOf(id)).toBe('done');
    expect(await world.seedRule.get()).toEqual(SeedRule.of({ ratio: 1.5, days: 14 }));
  });

  it('should_keep_the_rule_a_member_set_for_their_own_torrents', async () => {
    const id = await world.queue.enqueue(
      buildJob.setOwnSeedRule({ username: 'alice', rule: { ratio: null, days: 14 } }),
    );

    await world.worker.processNext();

    expect(world.queue.statusOf(id)).toBe('done');
    expect(await world.spacePreferences.findSeedRule(alice)).toEqual({
      kind: 'own',
      rule: SeedRule.of({ days: 14 }),
    });
  });

  it('should_take_a_member_back_to_the_box_rule', async () => {
    await world.spacePreferences.chooseSeedRule(alice, {
      kind: 'own',
      rule: SeedRule.of({ ratio: 1, days: 14 }),
    });
    const id = await world.queue.enqueue(buildJob.setOwnSeedRule({ username: 'alice', rule: null }));

    await world.worker.processNext();

    expect(world.queue.statusOf(id)).toBe('done');
    expect(await world.spacePreferences.findSeedRule(alice)).toEqual({ kind: 'box' });
  });

  it('should_keep_that_the_hourly_pass_started_a_cleanup_on_its_own', async () => {
    const id = await world.queue.enqueue(
      parseJob('clean-up-space', {
        username: 'alice',
        infoHashes: ['A'.repeat(40)],
        trigger: 'automatic',
      }),
    );

    await world.worker.processNext();

    expect(world.queue.statusOf(id)).toBe('done');
    expect((await world.cleanupReports.find(alice))?.trigger).toBe('automatic');
  });

  // the member reads it on their page; whoever looks after the box reads the log
  it('should_log_a_torrent_the_cleanup_could_not_remove', async () => {
    const scgiPort = ScgiPort.parse(51101);
    await world.instances.save(
      TorrentInstance.provision({
        username: alice,
        scgiPort,
        rtorrentPort: RtorrentPort.parse(45000),
      }).instance,
    );
    const film = InfoHash.parse('A'.repeat(40));
    world.memberTorrents.holds(scgiPort, [
      {
        infoHash: film,
        name: 'Example Film',
        size: Quota.gib(12),
        ratio: 3,
        finishedAt: '2026-07-01T08:00:00.000Z',
        path: '/home/alice/rtorrent/complete/Films/Example Film',
      },
    ]);
    world.memberTorrents.refusesToErase(film);
    await world.queue.enqueue(
      buildJob.cleanUpSpace({ username: 'alice', infoHashes: [film.value] }),
    );

    await world.worker.processNext();

    expect(world.warnings).toEqual([
      {
        context: { username: 'alice', torrent: 'Example Film', reason: 'notErased' },
        message: 'space cleanup: torrent not removed',
      },
    ]);
  });
});

describe('the daily backup', () => {
  it('should_warn_about_a_member_whose_restart_kit_was_not_archived', async () => {
    await enqueueCreateAlice();
    // creating alice chains her provisioning: let the queue settle first
    while (await world.worker.processNext()) {
      // each step ran the next job
    }
    world.backupHost.refusesToArchive('/home/alice');
    await world.queue.enqueue(buildJob.runBackup());

    await world.worker.processNext();

    expect(world.warnings).toContainEqual({
      context: { username: 'alice', reason: 'tar: write error' },
      message: 'backup: restart kit not archived',
    });
  });
});
