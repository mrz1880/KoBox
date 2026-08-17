import { eq } from 'drizzle-orm';
import type {
  SiteSettings,
  SiteSettingsRepository,
} from '../../domain/installation/ports.js';
import type { KoboxDatabase } from './db.js';
import { siteSettings } from './schema.js';

const ONLY_ROW = 1;

export class SqliteSiteSettingsRepository implements SiteSettingsRepository {
  constructor(private readonly db: KoboxDatabase) {}

  get(): Promise<SiteSettings | undefined> {
    const row = this.db.orm.select().from(siteSettings).where(eq(siteSettings.id, ONLY_ROW)).get();
    return Promise.resolve(row === undefined ? undefined : { domain: row.domain, email: row.email });
  }

  save(settings: SiteSettings): Promise<void> {
    const values = { id: ONLY_ROW, ...settings };
    this.db.orm
      .insert(siteSettings)
      .values(values)
      .onConflictDoUpdate({ target: siteSettings.id, set: values })
      .run();
    return Promise.resolve();
  }
}
