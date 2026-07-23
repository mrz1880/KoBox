import { createLogger, type Logger } from '../infrastructure/logging/logger.js';
import { ConsoleNotificationAdapter } from '../infrastructure/notifications/ConsoleNotificationAdapter.js';
import { KoboxDatabase } from '../infrastructure/persistence/db.js';
import { SqliteJobQueue } from '../infrastructure/persistence/SqliteJobQueue.js';
import { SqlitePortAllocator } from '../infrastructure/persistence/SqlitePortAllocator.js';
import { SqliteUserRepository } from '../infrastructure/persistence/SqliteUserRepository.js';
import { ExecFileRunner } from '../infrastructure/system/CommandRunner.js';
import { OpensslPasswordHasher } from '../infrastructure/system/OpensslPasswordHasher.js';
import { ProcessSocketHealthProbe } from '../infrastructure/system/ProcessSocketHealthProbe.js';
import { NoopQuotaAdapter, QuotaAdapter } from '../infrastructure/system/QuotaAdapter.js';
import { SftpAdapter } from '../infrastructure/system/SftpAdapter.js';
import { SystemAccountAdapter } from '../infrastructure/system/SystemAccountAdapter.js';
import { SystemdServiceControlAdapter } from '../infrastructure/system/SystemdServiceControlAdapter.js';
import { JobWorker } from './worker/JobWorker.js';
import { buildUseCases, type UseCases } from './useCases.js';

export const DEFAULT_DB_PATH = '/var/lib/kobox/kobox.db';

export interface Container {
  readonly db: KoboxDatabase;
  readonly logger: Logger;
  readonly useCases: UseCases;
  readonly queue: SqliteJobQueue;
  readonly worker: JobWorker;
  readonly hasher: OpensslPasswordHasher;
  readonly repo: SqliteUserRepository;
  readonly healthProbe: ProcessSocketHealthProbe;
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
  const useCases = buildUseCases({
    repo,
    accounts: new SystemAccountAdapter(runner),
    quota,
    sftp: new SftpAdapter(runner),
    services: new SystemdServiceControlAdapter(runner),
    notifications: new ConsoleNotificationAdapter(logger),
    allocator: new SqlitePortAllocator(db),
  });
  const queue = new SqliteJobQueue(db);
  return {
    db,
    logger,
    useCases,
    queue,
    worker: new JobWorker(queue, useCases),
    hasher: new OpensslPasswordHasher(runner),
    repo,
    healthProbe: new ProcessSocketHealthProbe(runner),
  };
}
