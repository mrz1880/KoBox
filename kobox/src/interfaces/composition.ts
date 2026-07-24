import { createLogger, type Logger } from '../infrastructure/logging/logger.js';
import { ConsoleNotificationAdapter } from '../infrastructure/notifications/ConsoleNotificationAdapter.js';
import { KoboxDatabase } from '../infrastructure/persistence/db.js';
import { SqliteBlocklistRepository } from '../infrastructure/persistence/SqliteBlocklistRepository.js';
import { SqliteJobQueue } from '../infrastructure/persistence/SqliteJobQueue.js';
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
import { NetworkServiceReloadAdapter } from '../infrastructure/system/NetworkServiceReloadAdapter.js';
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
  buildTorrentUseCases,
  buildTrackerUseCases,
  buildUseCases,
  type TorrentUseCases,
  type TrackerUseCases,
  type UseCases,
} from './useCases.js';

export const DEFAULT_DB_PATH = '/var/lib/kobox/kobox.db';
export const DEFAULT_KOBOX_BIN = '/usr/local/bin/kobox';

export function spoolDir(): string {
  return process.env.KOBOX_SPOOL ?? DEFAULT_SPOOL_DIR;
}

export interface Container {
  readonly db: KoboxDatabase;
  readonly logger: Logger;
  readonly useCases: UseCases;
  readonly torrentUseCases: TorrentUseCases;
  readonly trackerUseCases: TrackerUseCases;
  readonly queue: SqliteJobQueue;
  readonly worker: JobWorker;
  readonly hasher: OpensslPasswordHasher;
  readonly repo: SqliteUserRepository;
  readonly trackerRepo: SqliteTrackerRepository;
  readonly healthProbe: ProcessSocketHealthProbe;
  readonly spoolSweeper: TorrentEventSpoolSweeper;
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
  const useCases = buildUseCases({
    repo,
    accounts: new SystemAccountAdapter(runner),
    quota,
    sftp: new SftpAdapter(runner),
    services,
    notifications: new ConsoleNotificationAdapter(logger),
    allocator: new SqlitePortAllocator(db),
  });
  const queue = new SqliteJobQueue(db);
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
  });
  const iblocklistUser = process.env.KOBOX_IBLOCKLIST_USER;
  const iblocklistPin = process.env.KOBOX_IBLOCKLIST_PIN;
  const networkFiles = new RtorrentConfigAdapter(runner);
  const trackerRepo = new SqliteTrackerRepository(db);
  const trackerUseCases = buildTrackerUseCases({
    trackers: trackerRepo,
    blocklists: new SqliteBlocklistRepository(db),
    addresses: new SqliteUserAddressRepository(db),
    users: repo,
    instances: new SqliteTorrentInstanceRepository(db),
    dns: new DnsLookupResolverAdapter(),
    certPort: new OpensslTrackerCertAdapter(runner),
    certStore: new CertStoreAdapter(networkFiles, runner, logger, process.env.KOBOX_CERTS_DIR),
    download: new HttpsBlocklistDownloadAdapter(logger),
    catalog: new IblocklistCatalogAdapter(logger, process.env.KOBOX_IBLOCKLIST_CATALOG_URL),
    cache: new FsBlocklistCacheAdapter(process.env.KOBOX_BLOCKLIST_CACHE),
    files: networkFiles,
    reload: new NetworkServiceReloadAdapter(runner, logger),
    notifications: new ConsoleNotificationAdapter(logger),
    ...(iblocklistUser !== undefined &&
      iblocklistPin !== undefined && {
        credentials: { username: iblocklistUser, pin: iblocklistPin },
      }),
  });
  return {
    db,
    logger,
    useCases,
    torrentUseCases,
    trackerUseCases,
    queue,
    worker: new JobWorker(queue, useCases, torrentUseCases, trackerUseCases),
    hasher: new OpensslPasswordHasher(runner),
    repo,
    trackerRepo,
    healthProbe: new ProcessSocketHealthProbe(runner),
    spoolSweeper: new TorrentEventSpoolSweeper(
      spoolDir(),
      new GetentUsernameResolver(runner).resolve,
    ),
  };
}
