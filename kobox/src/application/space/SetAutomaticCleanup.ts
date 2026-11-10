import type { AutomaticCleanup } from '../../domain/space/AutomaticCleanup.js';
import type { CleanupTiming } from '../../domain/space/CleanupTiming.js';
import type { SpacePreferenceRepository } from '../../domain/space/ports.js';
import { SpaceWarning } from '../../domain/space/SpaceWarning.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly preferences: SpacePreferenceRepository;
}

// A member chose, in My account, what KoBox may delete on its own, and when:
// once they pass the critical line, or as soon as their rule allows.
export class SetAutomaticCleanup {
  constructor(private readonly deps: Deps) {}

  async execute(command: {
    readonly username: Username;
    readonly automatic: AutomaticCleanup;
    readonly timing: CleanupTiming;
  }): Promise<void> {
    const { warned } = await this.deps.preferences.find(command.username);
    await this.deps.preferences.chooseAutomatic(command.username, command.automatic);
    await this.deps.preferences.chooseTiming(command.username, command.timing);
    const next = SpaceWarning.afterChoosing(warned, command.automatic);
    if (next !== warned) {
      await this.deps.preferences.recordWarned(command.username, next);
    }
  }
}
