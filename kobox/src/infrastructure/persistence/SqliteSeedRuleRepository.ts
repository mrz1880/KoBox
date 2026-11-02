import { eq } from 'drizzle-orm';
import type { SeedRuleRepository } from '../../domain/space/ports.js';
import { SeedRule, type BoxSeedRule } from '../../domain/space/SeedRule.js';
import type { KoboxDatabase } from './db.js';
import { fromRatioMilli, toRatioMilli } from './ratioMilli.js';
import { seedRule } from './schema.js';

const ONLY_ROW = 1;

export class SqliteSeedRuleRepository implements SeedRuleRepository {
  constructor(private readonly db: KoboxDatabase) {}

  get(): Promise<BoxSeedRule> {
    const row = this.db.orm.select().from(seedRule).where(eq(seedRule.id, ONLY_ROW)).get();
    return Promise.resolve(
      row === undefined
        ? SeedRule.DEFAULT
        : SeedRule.of({ ratio: fromRatioMilli(row.ratioMilli), days: row.days }),
    );
  }

  save(rule: BoxSeedRule): Promise<void> {
    const values = { id: ONLY_ROW, ratioMilli: toRatioMilli(rule.ratio), days: rule.days };
    this.db.orm
      .insert(seedRule)
      .values(values)
      .onConflictDoUpdate({ target: seedRule.id, set: values })
      .run();
    return Promise.resolve();
  }
}
