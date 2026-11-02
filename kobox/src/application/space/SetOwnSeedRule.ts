import type { SpacePreferenceRepository } from '../../domain/space/ports.js';
import type { SeedRuleChoice } from '../../domain/space/SeedRuleChoice.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly preferences: Pick<SpacePreferenceRepository, 'chooseSeedRule'>;
}

// A member chose, in My account, the rule their own torrents answer to: the
// box's, or one of their own. As for the box rule, snapshots are not taken
// again here: the next hourly pass judges by it, and a cleanup in between is
// rechecked live against it.
export class SetOwnSeedRule {
  constructor(private readonly deps: Deps) {}

  async execute(command: {
    readonly username: Username;
    readonly choice: SeedRuleChoice;
  }): Promise<void> {
    await this.deps.preferences.chooseSeedRule(command.username, command.choice);
  }
}
