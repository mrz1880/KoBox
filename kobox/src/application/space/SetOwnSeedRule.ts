import type { SpacePreferenceRepository } from '../../domain/space/ports.js';
import type { SeedRuleChoice } from '../../domain/space/SeedRuleChoice.js';
import { SpaceWarning } from '../../domain/space/SpaceWarning.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly preferences: Pick<SpacePreferenceRepository, 'chooseSeedRule' | 'find' | 'recordWarned'>;
}

// A member chose, in My account, the rule their own torrents answer to: the
// box's, or one of their own. As for the box rule, snapshots are not taken
// again here: the next hourly pass judges by it, and a cleanup in between is
// rechecked live against it.
// A new rule may find something to clean where the old one did not, so it
// re-arms the warning the way choosing automatic cleanup does.
export class SetOwnSeedRule {
  constructor(private readonly deps: Deps) {}

  async execute(command: {
    readonly username: Username;
    readonly choice: SeedRuleChoice;
  }): Promise<void> {
    const { warned, automatic } = await this.deps.preferences.find(command.username);
    await this.deps.preferences.chooseSeedRule(command.username, command.choice);
    const next = SpaceWarning.afterChoosing(warned, automatic);
    if (next !== warned) {
      await this.deps.preferences.recordWarned(command.username, next);
    }
  }
}
