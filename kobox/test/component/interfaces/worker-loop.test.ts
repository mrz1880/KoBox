import { beforeEach, describe, expect, it } from 'vitest';
import { parseJob, type Job } from '../../../src/application/jobs/contract.js';
import type { BackupHostPort } from '../../../src/application/maintenance/BackupHostPort.js';
import type { MailDelivery } from '../../../src/application/maintenance/MailTransportPort.js';
import { InMemorySpeedtestRepository } from '../../../src/infrastructure/persistence/InMemorySpeedtestRepository.js';
import { InMemoryMailOutbox } from '../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import type { ClaimedJob, JobQueuePort } from '../../../src/application/jobs/JobQueuePort.js';
import { InfoHash } from '../../../src/domain/torrent/InfoHash.js';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import { Password } from '../../../src/domain/user/Password.js';
import type { PasswordHasherPort } from '../../../src/domain/user/ports.js';
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
import { FakeRtorrentConfig } from '../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { FakeRtorrentControl } from '../../../src/infrastructure/system/fakes/FakeRtorrentControl.js';
import { FakeServiceControl } from '../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeSftp } from '../../../src/infrastructure/system/fakes/FakeSftp.js';
import { FakeSystemAccounts } from '../../../src/infrastructure/system/fakes/FakeSystemAccounts.js';
import { FakeTorrentMetainfo } from '../../../src/infrastructure/system/fakes/FakeTorrentMetainfo.js';
import { FakeUserScriptRunner } from '../../../src/infrastructure/system/fakes/FakeUserScriptRunner.js';
import { FakeWatchDirs } from '../../../src/infrastructure/system/fakes/FakeWatchDirs.js';
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
import { JobWorker } from '../../../src/interfaces/worker/JobWorker.js';
import {
  buildDdlUseCases,
  buildMaintenanceUseCases,
  buildSecurityUseCases,
  buildTorrentUseCases,
  buildTrackerUseCases,
  buildUseCases,
} from '../../../src/interfaces/useCases.js';
import { InMemoryDebridAccountRepository } from '../../../src/infrastructure/persistence/InMemoryDebridAccountRepository.js';
import { InMemoryDebridDownloadRepository } from '../../../src/infrastructure/persistence/InMemoryDebridDownloadRepository.js';

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

class FakePasswordHasher implements PasswordHasherPort {
  hash(password: Password): Promise<HashedPassword> {
    return Promise.resolve(
      HashedPassword.parse(`$6$fakesalt$${'x'.repeat(20)}${String(password.reveal().length)}`),
    );
  }

  async verify(password: Password, hash: HashedPassword): Promise<boolean> {
    return (await this.hash(password)).value === hash.value;
  }
}

const alice = Username.parse('alice');

interface World {
  queue: InMemoryJobQueue;
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
  mailTransport: RecordingMailTransport;
  worker: JobWorker;
  hasher: FakePasswordHasher;
}

class RecordingMailTransport {
  readonly delivered: MailDelivery[] = [];

  deliver(mail: MailDelivery): Promise<void> {
    this.delivered.push(mail);
    return Promise.resolve();
  }
}

class NoopBackupHost implements BackupHostPort {
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

let world: World;

beforeEach(() => {
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
  const debridAccounts = new InMemoryDebridAccountRepository();
  const useCases = buildUseCases({
    repo,
    accounts,
    quota,
    sftp,
    services,
    notifications,
    credentials,
    sessions,
    debridAccounts,
    clock: () => '2026-07-25 10:00:00',
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
  const instances = new InMemoryTorrentInstanceRepository();
  const torrents = new InMemoryTorrentRepository();
  const scripts = new FakeUserScriptRunner();
  const rutorrentFiles = new FakeRtorrentConfig();
  const torrentUseCases = buildTorrentUseCases({
    users: repo,
    instances,
    torrents,
    config: rutorrentFiles,
    watchDirs: new FakeWatchDirs(),
    services,
    metainfo: new FakeTorrentMetainfo(),
    control: new FakeRtorrentControl(),
    scripts,
    announcers: new FakeAnnouncerSink(),
    templates: loadRtorrentTemplates(),
    settings: { koboxBin: '/usr/local/bin/kobox' },
    nginx: new FakeNetworkServices(),
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
  const queue = new InMemoryJobQueue();
  const outbox = new InMemoryMailOutbox();
  const mailTransport = new RecordingMailTransport();
  const maintenanceUseCases = buildMaintenanceUseCases({
    outbox,
    transport: mailTransport,
    backupHost: new NoopBackupHost(),
    backupSettings: { root: '/var/backups/kobox', ttlDays: 7, keepMin: 3, configDirs: [] },
    speedtest: { measure: () => Promise.reject(new Error('no speedtest in this suite')) },
    speedtests: new InMemorySpeedtestRepository(),
    clock: () => '2026-07-25 10:00:00',
  });
  const ddlUseCases = buildDdlUseCases({
    repo: new InMemoryDebridDownloadRepository(),
    accounts: debridAccounts,
    debrid: { unlock: () => Promise.reject(new Error('no debrid in this suite')) },
    credentials: { forUser: () => Promise.resolve(undefined) },
    downloader: {
      addUri: () => Promise.reject(new Error('no aria2 in this suite')),
      status: () => Promise.reject(new Error('no aria2 in this suite')),
    },
    placement: { place: () => Promise.reject(new Error('no placement in this suite')) },
    queue,
    clock: () => '2026-07-25 10:00:00',
    stagingBase: '/tmp/kobox-ddl-staging',
  });
  world = {
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
    hasher: new FakePasswordHasher(),
    ipset,
    outbox,
    mailTransport,
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
  };
});

async function enqueueCreateAlice(): Promise<number> {
  const job = await buildJob.createUser(
    {
      username: 'alice',
      email: 'alice@example.org',
      accountType: 'normal',
      quotaGib: 412,
      proxyPort: 8080,
    },
    Password.parse('s3cretpw'),
    world.hasher,
  );
  return world.queue.enqueue(job);
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

  it('should_enqueue_a_welcome_mail_without_any_password_in_it', async () => {
    await enqueueCreateAlice();

    await world.worker.drain();

    const recent = await world.outbox.listRecent(10);
    const welcome = recent.find((mail) => mail.subject.includes('ready'));
    expect(welcome?.recipient).toBe('alice@example.org');
    expect(welcome?.body).toContain('alice');
    expect(welcome?.body).not.toContain('s3cretpw');
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

  it('should_suspend_then_resume_via_jobs', async () => {
    await enqueueCreateAlice();
    await world.queue.enqueue(buildJob.suspendUser({ username: 'alice' }));
    await world.queue.enqueue(buildJob.resumeUser({ username: 'alice' }));

    await world.worker.drain();

    expect(await world.accounts.isLocked(alice)).toBe(false);
    expect(await world.services.isUserServiceRunning(alice)).toBe(true);
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
    await enqueueCreateAlice();
    await world.worker.drain();
    await world.queue.enqueue(buildJob.addUserAddress({ username: 'alice', ipv4: '203.0.113.9' }));

    await world.worker.drain();

    expect(world.networkFiles.contentAt('/etc/exports.d/kobox.exports')).toContain(
      '/home/alice 203.0.113.9(rw,sync,no_subtree_check,root_squash)',
    );
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

  it('should_render_but_not_load_when_the_kernel_lacks_ipset', async () => {
    world.ipset.supported = false;
    const id = await world.queue.enqueue(parseJob('apply-ipset', {}));

    await world.worker.drain();

    expect(world.queue.statusOf(id)).toBe('done'); // honest skip, not a failure
    expect(world.ipset.restored).toEqual([]);
    expect(world.networkFiles.contentAt('/etc/kobox/blocklist.ipset')).toContain('flush kobox-bl-next');
  });
});
