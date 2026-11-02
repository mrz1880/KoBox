import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeedRule } from '../../../src/domain/space/SeedRule.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteSeedRuleRepository } from '../../../src/infrastructure/persistence/SqliteSeedRuleRepository.js';

let dir: string;
let db: KoboxDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-seed-rule-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteSeedRuleRepository', () => {
  it('should_apply_the_default_rule_until_an_admin_sets_one', async () => {
    expect(await new SqliteSeedRuleRepository(db).get()).toEqual(SeedRule.DEFAULT);
  });

  it('should_give_back_the_rule_an_admin_saved_last', async () => {
    const repo = new SqliteSeedRuleRepository(db);
    await repo.save(SeedRule.of({ ratio: 1.5, days: 3 }));
    await repo.save(SeedRule.of({ ratio: 1.25, days: 14 }));

    expect(await repo.get()).toEqual(SeedRule.of({ ratio: 1.25, days: 14 }));
  });
});
