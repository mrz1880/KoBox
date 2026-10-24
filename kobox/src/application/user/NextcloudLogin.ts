import { NEXTCLOUD_MOUNTS, type NextcloudPort } from '../../domain/installation/NextcloudPort.js';
import type { PortalCredentialsPort } from '../../domain/portal/ports.js';
import { homeOf } from '../../domain/user/homeDirectory.js';
import type { Password } from '../../domain/user/Password.js';
import type { ServiceLoginPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly nextcloud: NextcloudPort;
  readonly credentials: PortalCredentialsPort;
}

// A member's Nextcloud account opens with their KoBox password. It is created
// the first time Nextcloud is handed that password (at signup, or at the first
// password change after Nextcloud was installed), and every later change
// resets it, so the two never drift apart.
export class NextcloudLogin implements ServiceLoginPort {
  constructor(private readonly deps: Deps) {}

  async setPassword(username: Username, password: Password): Promise<void> {
    const { nextcloud, credentials } = this.deps;
    await nextcloud.setUserPassword(username, password);
    // idempotent, and cheap enough to converge on every change
    for (const mount of NEXTCLOUD_MOUNTS) {
      await nextcloud.ensureLocalMount(username, mount.label, `${homeOf(username)}/${mount.under}`);
    }
    // only the people who run the box administer Nextcloud: members see their
    // files and nobody else's
    const login = await credentials.find(username);
    await nextcloud.setAdmin(username, login?.role === 'admin');
  }

  // Deleting a member deletes their home with userdel -r: an account left here
  // would be one nobody administers, on a system whose owner no longer exists.
  async remove(username: Username): Promise<void> {
    await this.deps.nextcloud.deleteUser(username);
  }
}
