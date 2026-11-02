import { describe, expect, it } from 'vitest';
import { SeedRule } from '../../../../src/domain/space/SeedRule.js';
import { ruleApplying } from '../../../../src/domain/space/SeedRuleChoice.js';

describe('ruleApplying', () => {
  const box = SeedRule.of({ ratio: 2, days: 7 });

  it('should_apply_the_box_rule_to_a_member_who_kept_it', () => {
    expect(ruleApplying({ kind: 'box' }, box)).toBe(box);
  });

  it('should_apply_their_own_rule_to_a_member_who_set_one', () => {
    const own = SeedRule.of({ days: 14 });

    expect(ruleApplying({ kind: 'own', rule: own }, box)).toBe(own);
  });
});
