import type {
  PasswordLinkRepository,
  PortalCredentialsPort,
  SessionStorePort,
} from '../../domain/portal/ports.js';
import type { Password } from '../../domain/user/Password.js';
import type { Username } from '../../domain/user/Username.js';
import type {
  NotificationPort,
  PasswordHasherPort,
  ServiceLoginPort,
  SystemAccountPort,
  UserRepository,
} from '../../domain/user/ports.js';
import { UserNotFoundError } from './errors.js';

export interface ChangePasswordCommand {
  readonly username: Username;
  readonly password: Password;
}

interface Deps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly notifications: NotificationPort;
  readonly credentials: PortalCredentialsPort;
  readonly sessions: SessionStorePort;
  readonly hasher: PasswordHasherPort;
  readonly logins: readonly ServiceLoginPort[];
  readonly links: PasswordLinkRepository;
  readonly clock: () => string;
}

export class ChangePassword {
  constructor(private readonly deps: Deps) {}

  async execute(command: ChangePasswordCommand): Promise<void> {
    const { repo, accounts, notifications, credentials, sessions, hasher, logins, clock } =
      this.deps;

    const user = await repo.findByUsername(command.username);
    if (!user) {
      throw new UserNotFoundError(command.username.value);
    }

    const passwordHash = await hasher.hash(command.password);
    await accounts.setPassword(user.username, passwordHash);
    for (const login of logins) {
      await login.setPassword(user.username, command.password);
    }
    // keep the portal mirror in sync; a pre-portal account gets a fresh
    // credential row with the default role. The app token is left out on
    // purpose: whoever held the old password could have issued one from the
    // Account page, and it must not outlive the password it was issued under.
    const existing = await credentials.find(user.username);
    await credentials.save(
      {
        username: user.username,
        passwordHash,
        role: existing?.role ?? 'user',
        // a completed change clears any forced-reset requirement
        mustChangePassword: false,
        ...(existing?.language !== undefined && { language: existing.language }),
      },
      clock(),
    );
    // a password change contains a compromise: every existing session dies with
    // it (self-change or admin reset), so a stolen cookie cannot outlive it
    await sessions.deleteForUser(user.username);
    // the password is chosen: a link still lying in a mailbox would change it again
    await this.deps.links.closeOpen(user.username, clock());
    await notifications.notify({ type: 'PasswordChanged', username: user.username.value });
  }
}
