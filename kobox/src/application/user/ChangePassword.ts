import type { HashedPassword } from '../../domain/user/HashedPassword.js';
import type { Username } from '../../domain/user/Username.js';
import type { NotificationPort, SystemAccountPort, UserRepository } from '../../domain/user/ports.js';
import { UserNotFoundError } from './errors.js';

export interface ChangePasswordCommand {
  readonly username: Username;
  readonly passwordHash: HashedPassword;
}

interface Deps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly notifications: NotificationPort;
}

export class ChangePassword {
  constructor(private readonly deps: Deps) {}

  async execute(command: ChangePasswordCommand): Promise<void> {
    const { repo, accounts, notifications } = this.deps;

    const user = await repo.findByUsername(command.username);
    if (!user) {
      throw new UserNotFoundError(command.username.value);
    }

    await accounts.setPassword(user.username, command.passwordHash);
    await notifications.notify({ type: 'PasswordChanged', username: user.username.value });
  }
}
