import type {
  AuthorizedKeysPort,
  SshKeyRepository,
  UserRepository,
} from '../../domain/user/ports.js';
import { SshPublicKey } from '../../domain/user/SshPublicKey.js';
import type { Username } from '../../domain/user/Username.js';
import { UserNotFoundError } from './errors.js';

interface Deps {
  readonly repo: UserRepository;
  readonly keys: SshKeyRepository;
  readonly authorizedKeys: AuthorizedKeysPort;
  readonly clock: () => string;
}

// Puts a member's own key on the box, restricted to file transfer. The stored
// copy is what the portal shows back; the file is what sshd reads. Writing the
// file first means a failure there leaves the two agreeing that nothing changed.
export class SetSshKey {
  constructor(private readonly deps: Deps) {}

  async execute(command: { username: Username; key: string }): Promise<void> {
    const user = await this.deps.repo.findByUsername(command.username);
    if (user === undefined) {
      throw new UserNotFoundError(command.username.value);
    }
    const key = SshPublicKey.parse(command.key);
    await this.deps.authorizedKeys.write(user.username, key.toAuthorizedKeysLine());
    await this.deps.keys.save({ username: user.username, key, addedAt: this.deps.clock() });
  }
}

export class RemoveSshKey {
  constructor(private readonly deps: Omit<Deps, 'clock'>) {}

  async execute(command: { username: Username }): Promise<void> {
    const user = await this.deps.repo.findByUsername(command.username);
    if (user === undefined) {
      throw new UserNotFoundError(command.username.value);
    }
    await this.deps.authorizedKeys.clear(user.username);
    await this.deps.keys.remove(user.username);
  }
}
