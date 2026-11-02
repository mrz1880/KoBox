import { describe, expect, it } from 'vitest';
import { SetSeedRule } from '../../../../src/application/space/SetSeedRule.js';
import { SeedRule } from '../../../../src/domain/space/SeedRule.js';
import { InMemorySeedRuleRepository } from '../../../../src/infrastructure/persistence/InMemorySeedRuleRepository.js';

describe('SetSeedRule', () => {
  it('should_keep_the_rule_an_admin_set_for_the_whole_box', async () => {
    const seedRule = new InMemorySeedRuleRepository();
    const rule = SeedRule.of({ ratio: 1.5, days: 14 });

    await new SetSeedRule({ seedRule }).execute(rule);

    expect(await seedRule.get()).toBe(rule);
  });
});
