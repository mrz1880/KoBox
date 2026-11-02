import type { SeedRuleRepository } from '../../domain/space/ports.js';
import { SeedRule, type BoxSeedRule } from '../../domain/space/SeedRule.js';

export class InMemorySeedRuleRepository implements SeedRuleRepository {
  private rule: BoxSeedRule = SeedRule.DEFAULT;

  get(): Promise<BoxSeedRule> {
    return Promise.resolve(this.rule);
  }

  save(rule: BoxSeedRule): Promise<void> {
    this.rule = rule;
    return Promise.resolve();
  }
}
