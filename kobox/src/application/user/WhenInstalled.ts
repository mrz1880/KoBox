import type { ComponentName } from '../../domain/installation/ComponentName.js';
import type { ComponentRegistry } from '../../domain/installation/ports.js';
import type { Password } from '../../domain/user/Password.js';
import type { ServiceLoginPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

export async function componentIsInstalled(
  components: ComponentRegistry,
  name: ComponentName,
): Promise<boolean> {
  return (await components.get(name))?.state.value === 'installed';
}

// Samba and Nextcloud are optional components: on a box without one, its login
// has nothing to hold, and a member's signup must not fail over it.
export class WhenInstalled implements ServiceLoginPort {
  constructor(
    private readonly component: ComponentName,
    private readonly components: ComponentRegistry,
    private readonly login: ServiceLoginPort,
  ) {}

  async setPassword(username: Username, password: Password): Promise<void> {
    if (await componentIsInstalled(this.components, this.component)) {
      await this.login.setPassword(username, password);
    }
  }

  async remove(username: Username): Promise<void> {
    if (await componentIsInstalled(this.components, this.component)) {
      await this.login.remove(username);
    }
  }
}
