import type { AccountType } from '../../domain/user/AccountType.js';
import type { EmailAddress } from '../../domain/user/EmailAddress.js';
import type { HashedPassword } from '../../domain/user/HashedPassword.js';
import type { ProxyPort } from '../../domain/user/Port.js';
import type { PortAllocatorPort } from '../../domain/user/PortAllocatorPort.js';
import type { Quota } from '../../domain/user/Quota.js';
import { SeedboxUser } from '../../domain/user/SeedboxUser.js';
import type { Username } from '../../domain/user/Username.js';
import type {
  NotificationPort,
  QuotaPort,
  ServiceControlPort,
  SftpPort,
  SystemAccountPort,
  UserRepository,
} from '../../domain/user/ports.js';
import { UserAlreadyExistsError } from './errors.js';

export interface CreateUserCommand {
  readonly username: Username;
  readonly email: EmailAddress;
  readonly accountType: AccountType;
  readonly quota: Quota;
  readonly proxyPort: ProxyPort;
  readonly passwordHash: HashedPassword;
}

interface Deps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly quota: QuotaPort;
  readonly sftp: SftpPort;
  readonly services: ServiceControlPort;
  readonly notifications: NotificationPort;
  readonly allocator: PortAllocatorPort;
}

export class CreateUser {
  constructor(private readonly deps: Deps) {}

  async execute(command: CreateUserCommand): Promise<SeedboxUser> {
    const { repo, accounts, quota, sftp, services, notifications, allocator } = this.deps;

    if (await repo.findByUsername(command.username)) {
      throw new UserAlreadyExistsError(command.username.value);
    }

    const scgiPort = await allocator.allocateScgiPort();
    const rtorrentPort = await allocator.allocateRtorrentPort();
    const { user, event } = SeedboxUser.create({
      username: command.username,
      email: command.email,
      accountType: command.accountType,
      quota: command.quota,
      scgiPort,
      rtorrentPort,
      proxyPort: command.proxyPort,
    });

    await accounts.createAccount(user.username);
    await accounts.setPassword(user.username, command.passwordHash);
    await quota.setQuota(user.username, user.quota);
    await sftp.enableChrootAccess(user.username);
    await services.startUserService(user.username);
    const saved = await repo.save(user);
    await notifications.notify(event);
    return saved;
  }
}
