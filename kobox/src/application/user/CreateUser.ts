import type { Role } from '../../domain/portal/Role.js';
import type { PortalCredentialsPort } from '../../domain/portal/ports.js';
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
  readonly role: Role;
}

interface Deps {
  readonly repo: UserRepository;
  readonly accounts: SystemAccountPort;
  readonly quota: QuotaPort;
  readonly sftp: SftpPort;
  readonly notifications: NotificationPort;
  readonly allocator: PortAllocatorPort;
  readonly credentials: PortalCredentialsPort;
  readonly clock: () => string;
}

export class CreateUser {
  constructor(private readonly deps: Deps) {}

  async execute(command: CreateUserCommand): Promise<SeedboxUser> {
    const { repo, accounts, quota, sftp, notifications, allocator, credentials, clock } =
      this.deps;

    if (await repo.findByUsername(command.username)) {
      throw new UserAlreadyExistsError(command.username.value);
    }

    const scgiPort = await allocator.allocateScgiPort();
    let rtorrentPort;
    try {
      rtorrentPort = await allocator.allocateRtorrentPort();
    } catch (error) {
      await allocator.releaseScgiPort(scgiPort);
      throw error;
    }
    const { user, event } = SeedboxUser.create({
      username: command.username,
      email: command.email,
      accountType: command.accountType,
      quota: command.quota,
      scgiPort,
      rtorrentPort,
      proxyPort: command.proxyPort,
    });

    // rtorrent unit start is deliberately absent: Phase 1 owns provisioning.
    let accountCreated = false;
    try {
      await accounts.createAccount(user.username);
      accountCreated = true;
      await accounts.setPassword(user.username, command.passwordHash);
      await quota.setQuota(user.username, user.quota);
      await sftp.enableChrootAccess(user.username);
      const saved = await repo.save(user);
      // portal login mirrors the system password (same crypt hash)
      await credentials.save(
        { username: user.username, passwordHash: command.passwordHash, role: command.role },
        clock(),
      );
      await notifications.notify(event);
      return saved;
    } catch (error) {
      // Compensate so a retry starts clean: no orphan account, no leaked port.
      if (accountCreated) {
        await accounts.deleteAccount(user.username).catch(() => undefined);
      }
      await credentials.delete(user.username).catch(() => undefined);
      await allocator.releaseScgiPort(scgiPort).catch(() => undefined);
      await allocator.releaseRtorrentPort(rtorrentPort).catch(() => undefined);
      throw error;
    }
  }
}
