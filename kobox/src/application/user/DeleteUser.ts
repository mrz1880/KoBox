import type { PortalCredentialsPort, SessionStorePort } from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type {
  NotificationPort,
  ServiceControlPort,
  SftpPort,
  SystemAccountPort,
  UserRepository,
} from '../../domain/user/ports.js';
import { UserNotFoundError } from './errors.js';

export interface DeleteUserCommand {
  readonly username: Username;
}

interface Deps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly sftp: SftpPort;
  readonly services: ServiceControlPort;
  readonly notifications: NotificationPort;
  readonly credentials: PortalCredentialsPort;
  readonly sessions: SessionStorePort;
}

export class DeleteUser {
  constructor(private readonly deps: Deps) {}

  async execute(command: DeleteUserCommand): Promise<void> {
    const { repo, accounts, sftp, services, notifications, credentials, sessions } = this.deps;

    const user = await repo.findByUsername(command.username);
    if (!user) {
      throw new UserNotFoundError(command.username.value);
    }

    await services.stopUserService(user.username);
    await sftp.disableChrootAccess(user.username);
    await accounts.deleteAccount(user.username);
    await sessions.deleteForUser(user.username);
    await credentials.delete(user.username);
    await repo.delete(user.username);
    await notifications.notify({ type: 'UserDeleted', username: user.username.value });
  }
}
