import { eq } from 'drizzle-orm';
import { ComponentName } from '../../domain/installation/ComponentName.js';
import { InstallState } from '../../domain/installation/InstallState.js';
import { Version } from '../../domain/installation/Version.js';
import type {
  ComponentRecord,
  ComponentRegistry,
} from '../../domain/installation/ports.js';
import type { KoboxDatabase } from './db.js';
import { components } from './schema.js';

export class SqliteComponentRegistry implements ComponentRegistry {
  constructor(private readonly db: KoboxDatabase) {}

  states(): Promise<ReadonlyMap<string, InstallState>> {
    const rows = this.db.orm.select().from(components).all();
    return Promise.resolve(new Map(rows.map((row) => [row.name, InstallState.parse(row.state)])));
  }

  get(name: ComponentName): Promise<ComponentRecord | undefined> {
    const row = this.db.orm
      .select()
      .from(components)
      .where(eq(components.name, name.value))
      .get();
    if (!row) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      name: ComponentName.parse(row.name),
      state: InstallState.parse(row.state),
      ...(row.version !== null && { version: Version.parse(row.version) }),
      ...(row.reason !== null && { reason: row.reason }),
      ...(row.installedAt !== null && { installedAt: row.installedAt }),
    });
  }

  markInstalled(name: ComponentName, version: Version | undefined, now: string): Promise<void> {
    return this.upsert(name, {
      state: 'installed',
      version: version?.value ?? null,
      reason: null,
      installedAt: now,
      updatedAt: now,
    });
  }

  markFailed(name: ComponentName, reason: string, now: string): Promise<void> {
    return this.upsert(name, {
      state: 'failed',
      version: null,
      reason,
      installedAt: null,
      updatedAt: now,
    });
  }

  markSkipped(name: ComponentName, reason: string, now: string): Promise<void> {
    return this.upsert(name, {
      state: 'skipped',
      version: null,
      reason,
      installedAt: null,
      updatedAt: now,
    });
  }

  reset(name: ComponentName, now: string): Promise<void> {
    return this.upsert(name, {
      state: 'to_install',
      version: null,
      reason: null,
      installedAt: null,
      updatedAt: now,
    });
  }

  private upsert(
    name: ComponentName,
    row: {
      state: 'to_install' | 'installed' | 'failed' | 'skipped';
      version: string | null;
      reason: string | null;
      installedAt: string | null;
      updatedAt: string;
    },
  ): Promise<void> {
    this.db.orm
      .insert(components)
      .values({ name: name.value, ...row })
      .onConflictDoUpdate({ target: components.name, set: row })
      .run();
    return Promise.resolve();
  }
}
