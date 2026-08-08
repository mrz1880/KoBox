import { eq } from 'drizzle-orm';
import type {
  DiagnosticsRepositoryPort,
  PackageUpdateSnapshot,
  ServiceLogSnapshot,
} from '../../application/maintenance/DiagnosticsPort.js';
import type { KoboxDatabase } from './db.js';
import { packageSnapshot, serviceLogs } from './schema.js';

// Both are diagnostic SNAPSHOTS, not archives: each capture replaces the last.
const SINGLETON_ID = 1;

export class SqliteDiagnosticsRepository implements DiagnosticsRepositoryPort {
  constructor(private readonly db: KoboxDatabase) {}

  saveLog(snapshot: ServiceLogSnapshot): Promise<void> {
    this.db.orm
      .insert(serviceLogs)
      .values(snapshot)
      .onConflictDoUpdate({
        target: serviceLogs.unit,
        set: { content: snapshot.content, capturedAt: snapshot.capturedAt },
      })
      .run();
    return Promise.resolve();
  }

  findLog(unit: string): Promise<ServiceLogSnapshot | undefined> {
    const row = this.db.orm.select().from(serviceLogs).where(eq(serviceLogs.unit, unit)).get();
    return Promise.resolve(row);
  }

  savePackages(snapshot: PackageUpdateSnapshot): Promise<void> {
    this.db.orm
      .insert(packageSnapshot)
      .values({ id: SINGLETON_ID, ...snapshot })
      .onConflictDoUpdate({ target: packageSnapshot.id, set: { ...snapshot } })
      .run();
    return Promise.resolve();
  }

  findPackages(): Promise<PackageUpdateSnapshot | undefined> {
    const row = this.db.orm
      .select()
      .from(packageSnapshot)
      .where(eq(packageSnapshot.id, SINGLETON_ID))
      .get();
    return Promise.resolve(row);
  }
}
