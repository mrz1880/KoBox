import type { AutomaticCleanup } from '../../domain/space/AutomaticCleanup.js';
import type { SpacePreferenceRepository, SpacePreferences } from '../../domain/space/ports.js';
import type { SeedRuleChoice } from '../../domain/space/SeedRuleChoice.js';
import type { Username } from '../../domain/user/Username.js';

const UNTOUCHED: SpacePreferences = { automatic: 'off', warned: false };

export class InMemorySpacePreferenceRepository implements SpacePreferenceRepository {
  private readonly preferences = new Map<string, SpacePreferences>();
  private readonly seedRules = new Map<string, SeedRuleChoice>();

  find(username: Username): Promise<SpacePreferences> {
    return Promise.resolve(this.preferences.get(username.value) ?? UNTOUCHED);
  }

  async chooseAutomatic(username: Username, automatic: AutomaticCleanup): Promise<void> {
    this.preferences.set(username.value, { ...(await this.find(username)), automatic });
  }

  async recordWarned(username: Username, warned: boolean): Promise<void> {
    this.preferences.set(username.value, { ...(await this.find(username)), warned });
  }

  findSeedRule(username: Username): Promise<SeedRuleChoice> {
    return Promise.resolve(this.seedRules.get(username.value) ?? { kind: 'box' });
  }

  chooseSeedRule(username: Username, choice: SeedRuleChoice): Promise<void> {
    this.seedRules.set(username.value, choice);
    return Promise.resolve();
  }
}
