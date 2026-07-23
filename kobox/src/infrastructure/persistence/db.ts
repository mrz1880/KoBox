import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

export type Drizzle = BetterSQLite3Database<typeof schema>;

export class KoboxDatabase {
  private constructor(
    readonly raw: Database.Database,
    readonly orm: Drizzle,
  ) {}

  static open(filePath: string): KoboxDatabase {
    const raw = new Database(filePath);
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    raw.pragma('busy_timeout = 5000');
    const orm = drizzle(raw, { schema });
    migrate(orm, { migrationsFolder: MIGRATIONS_FOLDER });
    return new KoboxDatabase(raw, orm);
  }

  close(): void {
    this.raw.close();
  }
}
