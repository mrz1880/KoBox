import type { PortalCredentialsPort, SessionStorePort } from '../../domain/portal/ports.js';
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
  readonly credentials: PortalCredentialsPort;
  readonly sessions: SessionStorePort;
  readonly clock: () => string;
}

export class ChangePassword {
  constructor(private readonly deps: Deps) {}

  async execute(command: ChangePasswordCommand): Promise<void> {
    const { repo, accounts, notifications, credentials, sessions, clock } = this.deps;

    const user = await repo.findByUsername(command.username);
    if (!user) {
      throw new UserNotFoundError(command.username.value);
    }

    await accounts.setPassword(user.username, command.passwordHash);
    // keep the portal mirror in sync; a pre-portal account gets a fresh
    // credential row with the default role
    const existing = await credentials.find(user.username);
    await credentials.save(
      {
        username: user.username,
        passwordHash: command.passwordHash,
        role: existing?.role ?? 'user',
      },
      clock(),
    );
    // a password change contains a compromise: every existing session dies with
    // it (self-change or admin reset), so a stolen cookie cannot outlive it
    await sessions.deleteForUser(user.username);
    await notifications.notify({ type: 'PasswordChanged', username: user.username.value });
  }
}
