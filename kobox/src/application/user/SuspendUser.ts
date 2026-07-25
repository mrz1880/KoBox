import type { SessionStorePort } from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type {
  NotificationPort,
  ServiceControlPort,
  SftpPort,
  SystemAccountPort,
  UserRepository,
} from '../../domain/user/ports.js';
import { UserNotFoundError } from './errors.js';

export interface SuspendUserCommand {
  readonly username: Username;
}

interface Deps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly sftp: SftpPort;
  readonly services: ServiceControlPort;
  readonly notifications: NotificationPort;
  readonly sessions: SessionStorePort;
}

// Reversible suspension (issue #39): cut all access, keep account and data.
// Effects are re-applied even when already suspended so a partially failed
// earlier run converges; only the state transition emits an event.
export class SuspendUser {
  constructor(private readonly deps: Deps) {}

  async execute(command: SuspendUserCommand): Promise<void> {
    const { repo, accounts, sftp, services, notifications, sessions } = this.deps;

    const user = await repo.findByUsername(command.username);
    if (!user) {
      throw new UserNotFoundError(command.username.value);
    }

    const { user: suspended, event } = user.suspend();
    await accounts.lockAccount(suspended.username);
    await accounts.terminateSessions(suspended.username);
    await sftp.disableChrootAccess(suspended.username);
    await services.stopUserService(suspended.username);
    // live portal sessions die with the SSH ones
    await sessions.deleteForUser(suspended.username);
    await repo.save(suspended);
    if (event) {
      await notifications.notify(event);
    }
  }
}
