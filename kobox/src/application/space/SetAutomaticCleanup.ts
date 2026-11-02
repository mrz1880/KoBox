import type { AutomaticCleanup } from '../../domain/space/AutomaticCleanup.js';
import type { SpacePreferenceRepository } from '../../domain/space/ports.js';
import { SpaceWarning } from '../../domain/space/SpaceWarning.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly preferences: SpacePreferenceRepository;
}

// A member chose, in My account, what KoBox may delete on its own once they
// pass the critical line.
export class SetAutomaticCleanup {
  constructor(private readonly deps: Deps) {}

  async execute(command: {
    readonly username: Username;
    readonly automatic: AutomaticCleanup;
  }): Promise<void> {
    const { warned } = await this.deps.preferences.find(command.username);
    await this.deps.preferences.chooseAutomatic(command.username, command.automatic);
    const next = SpaceWarning.afterChoosing(warned, command.automatic);
    if (next !== warned) {
      await this.deps.preferences.recordWarned(command.username, next);
    }
  }
}
