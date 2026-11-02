import type { AutomaticCleanup } from '../../domain/space/AutomaticCleanup.js';
import type { SpacePreferenceRepository, SpacePreferences } from '../../domain/space/ports.js';
import type { Username } from '../../domain/user/Username.js';

const UNTOUCHED: SpacePreferences = { automatic: 'off', warned: false };

export class InMemorySpacePreferenceRepository implements SpacePreferenceRepository {
  private readonly preferences = new Map<string, SpacePreferences>();

  find(username: Username): Promise<SpacePreferences> {
    return Promise.resolve(this.preferences.get(username.value) ?? UNTOUCHED);
  }

  async chooseAutomatic(username: Username, automatic: AutomaticCleanup): Promise<void> {
    this.preferences.set(username.value, { ...(await this.find(username)), automatic });
  }

  async recordWarned(username: Username, warned: boolean): Promise<void> {
    this.preferences.set(username.value, { ...(await this.find(username)), warned });
  }
}
