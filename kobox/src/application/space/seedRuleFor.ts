import type { SeedRuleRepository, SpacePreferenceRepository } from '../../domain/space/ports.js';
import type { SeedRule } from '../../domain/space/SeedRule.js';
import { ruleApplying } from '../../domain/space/SeedRuleChoice.js';
import type { Username } from '../../domain/user/Username.js';

export interface SeedRuleForDeps {
  readonly seedRule: Pick<SeedRuleRepository, 'get'>;
  readonly preferences: Pick<SpacePreferenceRepository, 'findSeedRule'>;
}

// The rule a member's torrents are judged by right now: theirs if they set
// one, the box's otherwise. The judge and the page that explains it both read
// it from here.
export async function seedRuleFor(deps: SeedRuleForDeps, username: Username): Promise<SeedRule> {
  const [choice, box] = await Promise.all([
    deps.preferences.findSeedRule(username),
    deps.seedRule.get(),
  ]);
  return ruleApplying(choice, box);
}
