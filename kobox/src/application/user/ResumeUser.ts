import type { Username } from '../../domain/user/Username.js';
import type {
  NotificationPort,
  ServiceControlPort,
  SftpPort,
  SystemAccountPort,
  UserRepository,
} from '../../domain/user/ports.js';
import { UserNotFoundError } from './errors.js';

export interface ResumeUserCommand {
  readonly username: Username;
}

interface Deps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly sftp: SftpPort;
  readonly services: ServiceControlPort;
  readonly notifications: NotificationPort;
}

export class ResumeUser {
  constructor(private readonly deps: Deps) {}

  async execute(command: ResumeUserCommand): Promise<void> {
    const { repo, accounts, sftp, services, notifications } = this.deps;

    const user = await repo.findByUsername(command.username);
    if (!user) {
      throw new UserNotFoundError(command.username.value);
    }

    const { user: resumed, event } = user.resume();
    await accounts.unlockAccount(resumed.username);
    await sftp.enableChrootAccess(resumed.username);
    await services.startUserService(resumed.username);
    await repo.save(resumed);
    if (event) {
      await notifications.notify(event);
    }
  }
}
