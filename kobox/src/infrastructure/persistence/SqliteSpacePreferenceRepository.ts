import { eq } from 'drizzle-orm';
import { parseAutomaticCleanup, type AutomaticCleanup } from '../../domain/space/AutomaticCleanup.js';
import type { SpacePreferenceRepository, SpacePreferences } from '../../domain/space/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { spacePreferences } from './schema.js';

// A member with no row yet: the column defaults say the same.
const UNTOUCHED: SpacePreferences = { automatic: 'off', warned: false };

export class SqliteSpacePreferenceRepository implements SpacePreferenceRepository {
  constructor(private readonly db: KoboxDatabase) {}

  find(username: Username): Promise<SpacePreferences> {
    const row = this.db.orm
      .select()
      .from(spacePreferences)
      .where(eq(spacePreferences.username, username.value))
      .get();
    return Promise.resolve(
      row === undefined
        ? UNTOUCHED
        : { automatic: parseAutomaticCleanup(row.automatic), warned: row.warned === 1 },
    );
  }

  chooseAutomatic(username: Username, automatic: AutomaticCleanup): Promise<void> {
    return this.upsert(username, { automatic });
  }

  recordWarned(username: Username, warned: boolean): Promise<void> {
    return this.upsert(username, { warned: warned ? 1 : 0 });
  }

  // writes one column, leaving the other as it was (or at its default)
  private upsert(
    username: Username,
    set: { readonly automatic: AutomaticCleanup } | { readonly warned: number },
  ): Promise<void> {
    this.db.orm
      .insert(spacePreferences)
      .values({ username: username.value, ...set })
      .onConflictDoUpdate({ target: spacePreferences.username, set })
      .run();
    return Promise.resolve();
  }
}
