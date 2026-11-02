import type { SeedRuleRepository } from '../../domain/space/ports.js';
import { SeedRule } from '../../domain/space/SeedRule.js';

export class InMemorySeedRuleRepository implements SeedRuleRepository {
  private rule: SeedRule = SeedRule.DEFAULT;

  get(): Promise<SeedRule> {
    return Promise.resolve(this.rule);
  }

  save(rule: SeedRule): Promise<void> {
    this.rule = rule;
    return Promise.resolve();
  }
}
