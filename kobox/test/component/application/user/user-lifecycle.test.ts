import { beforeEach, describe, expect, it } from 'vitest';
import { ChangePassword } from '../../../../src/application/user/ChangePassword.js';
import { CreateUser } from '../../../../src/application/user/CreateUser.js';
import { DeleteUser } from '../../../../src/application/user/DeleteUser.js';
import { ResumeUser } from '../../../../src/application/user/ResumeUser.js';
import { SuspendUser } from '../../../../src/application/user/SuspendUser.js';
import {
  UserAlreadyExistsError,
  UserNotFoundError,
} from '../../../../src/application/user/errors.js';
import { AccountType } from '../../../../src/domain/user/AccountType.js';
import { EmailAddress } from '../../../../src/domain/user/EmailAddress.js';
import { Password } from '../../../../src/domain/user/Password.js';
import { ProxyPort, RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import type { PortAllocatorPort } from '../../../../src/domain/user/PortAllocatorPort.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNotifications } from '../../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeQuota } from '../../../../src/infrastructure/system/fakes/FakeQuota.js';
import { FakeServiceControl } from '../../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeSftp } from '../../../../src/infrastructure/system/fakes/FakeSftp.js';
import { FakeSystemAccounts } from '../../../../src/infrastructure/system/fakes/FakeSystemAccounts.js';

class SequentialPortAllocator implements PortAllocatorPort {
  private nextScgi = 51101;
  private nextRtorrent = 45000;

  allocateScgiPort(): Promise<ScgiPort> {
    return Promise.resolve(ScgiPort.parse(this.nextScgi++));
  }

  allocateRtorrentPort(): Promise<RtorrentPort> {
    return Promise.resolve(RtorrentPort.parse(this.nextRtorrent++));
  }
}

const user-f = Username.parse('user-f');

function createUserCommand() {
  return {
    username: user-f,
    email: EmailAddress.parse('user-f@example.org'),
    accountType: AccountType.normal,
    quota: Quota.gib(412),
    proxyPort: ProxyPort.parse(8080),
    password: Password.parse('s3cretpw'),
  };
}

interface World {
  repo: InMemoryUserRepository;
  accounts: FakeSystemAccounts;
  quota: FakeQuota;
  sftp: FakeSftp;
  services: FakeServiceControl;
  notifications: FakeNotifications;
  createUser: CreateUser;
  deleteUser: DeleteUser;
  changePassword: ChangePassword;
  suspendUser: SuspendUser;
  resumeUser: ResumeUser;
}

let world: World;

beforeEach(() => {
  const repo = new InMemoryUserRepository();
  const accounts = new FakeSystemAccounts();
  const quota = new FakeQuota();
  const sftp = new FakeSftp();
  const services = new FakeServiceControl();
  const notifications = new FakeNotifications();
  const allocator = new SequentialPortAllocator();
  const deps = { repo, accounts, quota, sftp, services, notifications };
  world = {
    ...deps,
    createUser: new CreateUser({ ...deps, allocator }),
    deleteUser: new DeleteUser(deps),
    changePassword: new ChangePassword(deps),
    suspendUser: new SuspendUser(deps),
    resumeUser: new ResumeUser(deps),
  };
});

describe('CreateUser', () => {
  it('should_provision_account_quota_chroot_service_and_persist', async () => {
    const user = await world.createUser.execute(createUserCommand());

    expect(user.id?.value).toBe(1);
    expect(user.scgiPort.value).toBe(51101);
    expect(await world.accounts.accountExists(user-f)).toBe(true);
    expect(world.accounts.passwordWasSetFor(user-f)).toBe(true);
    expect(world.quota.quotaOf(user-f)?.toGib()).toBe(412);
    expect(await world.sftp.isChrootAccessEnabled(user-f)).toBe(true);
    expect(await world.services.isUserServiceRunning(user-f)).toBe(true);
    expect(world.notifications.published).toEqual([{ type: 'UserCreated', username: 'user-f' }]);
  });

  it('should_reject_duplicate_usernames', async () => {
    await world.createUser.execute(createUserCommand());

    await expect(world.createUser.execute(createUserCommand())).rejects.toThrow(
      UserAlreadyExistsError,
    );
  });

  it('should_allocate_distinct_ports_for_successive_users', async () => {
    const first = await world.createUser.execute(createUserCommand());
    const second = await world.createUser.execute({
      ...createUserCommand(),
      username: Username.parse('user-a'),
      email: EmailAddress.parse('user-a@example.org'),
    });

    expect(second.scgiPort.equals(first.scgiPort)).toBe(false);
    expect(second.rtorrentPort.equals(first.rtorrentPort)).toBe(false);
  });
});

describe('DeleteUser', () => {
  it('should_tear_down_everything_and_notify', async () => {
    await world.createUser.execute(createUserCommand());

    await world.deleteUser.execute({ username: user-f });

    expect(await world.accounts.accountExists(user-f)).toBe(false);
    expect(await world.sftp.isChrootAccessEnabled(user-f)).toBe(false);
    expect(await world.services.isUserServiceRunning(user-f)).toBe(false);
    expect(await world.repo.findByUsername(user-f)).toBeUndefined();
    expect(world.notifications.published.at(-1)).toEqual({
      type: 'UserDeleted',
      username: 'user-f',
    });
  });

  it('should_reject_deleting_an_unknown_user', async () => {
    await expect(world.deleteUser.execute({ username: user-f })).rejects.toThrow(UserNotFoundError);
  });
});

describe('ChangePassword', () => {
  it('should_set_the_system_password_and_notify', async () => {
    await world.createUser.execute(createUserCommand());

    await world.changePassword.execute({ username: user-f, password: Password.parse('newpass99') });

    expect(world.notifications.published.at(-1)).toEqual({
      type: 'PasswordChanged',
      username: 'user-f',
    });
  });

  it('should_reject_unknown_users', async () => {
    await expect(
      world.changePassword.execute({ username: user-f, password: Password.parse('newpass99') }),
    ).rejects.toThrow(UserNotFoundError);
  });
});

describe('SuspendUser / ResumeUser', () => {
  it('should_suspend_reversibly_without_deleting_anything', async () => {
    await world.createUser.execute(createUserCommand());

    await world.suspendUser.execute({ username: user-f });

    expect(await world.accounts.isLocked(user-f)).toBe(true);
    expect(await world.sftp.isChrootAccessEnabled(user-f)).toBe(false);
    expect(await world.services.isUserServiceRunning(user-f)).toBe(false);
    expect(await world.accounts.accountExists(user-f)).toBe(true); // nothing deleted
    expect((await world.repo.findByUsername(user-f))?.status.isSuspended()).toBe(true);
    expect(world.quota.quotaOf(user-f)?.toGib()).toBe(412); // quota untouched
    expect(world.notifications.published.at(-1)).toEqual({
      type: 'UserSuspended',
      username: 'user-f',
    });
  });

  it('should_make_suspend_idempotent_and_convergent', async () => {
    await world.createUser.execute(createUserCommand());
    await world.suspendUser.execute({ username: user-f });
    const notificationCount = world.notifications.published.length;

    await world.suspendUser.execute({ username: user-f });

    expect(await world.accounts.isLocked(user-f)).toBe(true);
    expect(world.notifications.published.length).toBe(notificationCount); // no duplicate event
  });

  it('should_resume_back_to_full_service', async () => {
    await world.createUser.execute(createUserCommand());
    await world.suspendUser.execute({ username: user-f });

    await world.resumeUser.execute({ username: user-f });

    expect(await world.accounts.isLocked(user-f)).toBe(false);
    expect(await world.sftp.isChrootAccessEnabled(user-f)).toBe(true);
    expect(await world.services.isUserServiceRunning(user-f)).toBe(true);
    expect((await world.repo.findByUsername(user-f))?.status.isSuspended()).toBe(false);
    expect(world.notifications.published.at(-1)).toEqual({
      type: 'UserResumed',
      username: 'user-f',
    });
  });

  it('should_reject_suspending_an_unknown_user', async () => {
    await expect(world.suspendUser.execute({ username: user-f })).rejects.toThrow(UserNotFoundError);
  });
});
