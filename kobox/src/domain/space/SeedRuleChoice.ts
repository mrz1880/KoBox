import type { BoxSeedRule, SeedRule } from './SeedRule.js';

// Whose seed rule a member's torrents answer to: the box's, which an admin
// sets and every member keeps until they choose otherwise, or their own. Their
// own may ask less than the box: it is their tracker accounts that carry it.
export type SeedRuleChoice =
  | { readonly kind: 'box' }
  | { readonly kind: 'own'; readonly rule: SeedRule };

// The rule a member's torrents are judged by, given the box's rule.
export function ruleApplying(choice: SeedRuleChoice, box: BoxSeedRule): SeedRule {
  return choice.kind === 'own' ? choice.rule : box;
}
