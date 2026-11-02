import { eq } from 'drizzle-orm';
import { parseAutomaticCleanup, type AutomaticCleanup } from '../../domain/space/AutomaticCleanup.js';
import type { SpacePreferenceRepository, SpacePreferences } from '../../domain/space/ports.js';
import { SeedRule } from '../../domain/space/SeedRule.js';
import type { SeedRuleChoice } from '../../domain/space/SeedRuleChoice.js';
import type { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { fromRatioMilli, toRatioMilli } from './ratioMilli.js';
import { spacePreferences } from './schema.js';

// A member with no row yet: the column defaults say the same.
const UNTOUCHED: SpacePreferences = { automatic: 'off', warned: false };

// The own-rule columns as the choice reads them: no days is the box's rule.
interface OwnRuleColumns {
  readonly ownRuleRatioMilli: number | null;
  readonly ownRuleDays: number | null;
}

function choiceOf(columns: OwnRuleColumns): SeedRuleChoice {
  const { ownRuleRatioMilli, ownRuleDays } = columns;
  if (ownRuleDays === null) {
    return { kind: 'box' };
  }
  const ratio = ownRuleRatioMilli === null ? undefined : fromRatioMilli(ownRuleRatioMilli);
  return { kind: 'own', rule: SeedRule.of({ ratio, days: ownRuleDays }) };
}

function columnsOf(choice: SeedRuleChoice): OwnRuleColumns {
  if (choice.kind === 'box') {
    return { ownRuleRatioMilli: null, ownRuleDays: null };
  }
  const { ratio, days } = choice.rule;
  return {
    ownRuleRatioMilli: ratio === undefined ? null : toRatioMilli(ratio),
    ownRuleDays: days,
  };
}

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

  findSeedRule(username: Username): Promise<SeedRuleChoice> {
    const row = this.db.orm
      .select({
        ownRuleRatioMilli: spacePreferences.ownRuleRatioMilli,
        ownRuleDays: spacePreferences.ownRuleDays,
      })
      .from(spacePreferences)
      .where(eq(spacePreferences.username, username.value))
      .get();
    return Promise.resolve(row === undefined ? { kind: 'box' } : choiceOf(row));
  }

  chooseSeedRule(username: Username, choice: SeedRuleChoice): Promise<void> {
    return this.upsert(username, columnsOf(choice));
  }

  // writes one choice, leaving the others as they were (or at their default)
  private upsert(
    username: Username,
    set:
      | { readonly automatic: AutomaticCleanup }
      | { readonly warned: number }
      | OwnRuleColumns,
  ): Promise<void> {
    this.db.orm
      .insert(spacePreferences)
      .values({ username: username.value, ...set })
      .onConflictDoUpdate({ target: spacePreferences.username, set })
      .run();
    return Promise.resolve();
  }
}
