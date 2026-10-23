import type { NextcloudPort } from '../../domain/installation/NextcloudPort.js';
import type { ComponentRegistry } from '../../domain/installation/ports.js';
import type { PortalCredentialsPort } from '../../domain/portal/ports.js';
import type { Role } from '../../domain/portal/Role.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { nextcloudIsInstalled } from './ProvisionNextcloudAccount.js';
import { PortalLoginMissingError, UserNotFoundError } from './errors.js';

export interface ChangeRoleCommand {
  readonly username: Username;
  readonly role: Role;
}

interface Deps {
  readonly repo: UserRepository;
  readonly credentials: PortalCredentialsPort;
  readonly components: ComponentRegistry;
  readonly nextcloud: NextcloudPort;
  readonly clock: () => string;
}

// Moves a member between the two portal capability levels. Live sessions need
// no reset: Authenticate re-reads the role on every request.
export class ChangeRole {
  constructor(private readonly deps: Deps) {}

  async execute(command: ChangeRoleCommand): Promise<void> {
    const { repo, credentials, clock } = this.deps;
    const user = await repo.findByUsername(command.username);
    if (user === undefined) {
      throw new UserNotFoundError(command.username.value);
    }
    const existing = await credentials.find(command.username);
    if (existing === undefined) {
      throw new PortalLoginMissingError(user.username.value);
    }
    await credentials.save({ ...existing, role: command.role }, clock());
    // the Nextcloud admins are the box admins: a demoted member must not keep
    // administering the files of everybody else
    if (
      (await nextcloudIsInstalled(this.deps.components)) &&
      (await this.deps.nextcloud.hasUser(user.username))
    ) {
      await this.deps.nextcloud.setAdmin(user.username, command.role === 'admin');
    }
  }
}
