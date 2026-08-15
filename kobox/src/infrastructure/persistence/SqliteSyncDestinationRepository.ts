import { eq } from 'drizzle-orm';
import { LoneFilePlacement } from '../../domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../domain/sync/RemoteHost.js';
import { RemotePath } from '../../domain/sync/RemotePath.js';
import { RemotePort } from '../../domain/sync/RemotePort.js';
import { SyncDestination, type ConnectionCheck } from '../../domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../domain/sync/TransferBatchSize.js';
import type { SyncDestinationRepository } from '../../domain/sync/ports.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { syncDestinations } from './schema.js';

type DestinationRow = typeof syncDestinations.$inferSelect;

function checkOf(row: DestinationRow): ConnectionCheck | undefined {
  if (row.lastCheckOk === null || row.lastCheckAt === null) {
    return undefined;
  }
  return {
    ok: row.lastCheckOk === 1,
    at: row.lastCheckAt,
    ...(row.lastCheckDetail !== null && { detail: row.lastCheckDetail }),
    ...(row.lastCheckFingerprint !== null && { fingerprint: row.lastCheckFingerprint }),
  };
}

export class SqliteSyncDestinationRepository implements SyncDestinationRepository {
  constructor(private readonly db: KoboxDatabase) {}

  findByUsername(username: Username): Promise<SyncDestination | undefined> {
    const row = this.db.orm
      .select()
      .from(syncDestinations)
      .where(eq(syncDestinations.username, username.value))
      .get();
    if (!row) {
      return Promise.resolve(undefined);
    }
    const check = checkOf(row);
    return Promise.resolve(
      SyncDestination.restore({
        username: Username.parse(row.username),
        host: RemoteHost.parse(row.host),
        port: RemotePort.parse(row.port),
        account: RemoteAccount.parse(row.account),
        sealedPassword: row.sealedPassword,
        path: RemotePath.parse(row.path),
        batchSize: TransferBatchSize.parse(row.batchSize),
        placement: LoneFilePlacement.parse(row.placement),
        ...(check !== undefined && { lastCheck: check }),
      }),
    );
  }

  save(destination: SyncDestination): Promise<void> {
    const values = {
      username: destination.username.value,
      host: destination.host.value,
      port: destination.port.value,
      account: destination.account.value,
      sealedPassword: destination.sealedPassword,
      path: destination.path.value,
      batchSize: destination.batchSize.value,
      placement: destination.placement.value,
      lastCheckOk: destination.lastCheck === undefined ? null : destination.lastCheck.ok ? 1 : 0,
      lastCheckAt: destination.lastCheck?.at ?? null,
      lastCheckDetail: destination.lastCheck?.detail ?? null,
      lastCheckFingerprint: destination.lastCheck?.fingerprint ?? null,
    };
    this.db.orm
      .insert(syncDestinations)
      .values(values)
      .onConflictDoUpdate({ target: syncDestinations.username, set: values })
      .run();
    return Promise.resolve();
  }

  delete(username: Username): Promise<void> {
    this.db.orm.delete(syncDestinations).where(eq(syncDestinations.username, username.value)).run();
    return Promise.resolve();
  }
}
