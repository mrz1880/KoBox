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
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
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
  private readonly freedScgi: number[] = [];
  private readonly freedRtorrent: number[] = [];

  allocateScgiPort(): Promise<ScgiPort> {
    return Promise.resolve(ScgiPort.parse(this.freedScgi.shift() ?? this.nextScgi++));
  }

  allocateRtorrentPort(): Promise<RtorrentPort> {
    return Promise.resolve(RtorrentPort.parse(this.freedRtorrent.shift() ?? this.nextRtorrent++));
  }

  releaseScgiPort(port: ScgiPort): Promise<void> {
    this.freedScgi.push(port.value);
    return Promise.resolve();
  }

  releaseRtorrentPort(port: RtorrentPort): Promise<void> {
    this.freedRtorrent.push(port.value);
    return Promise.resolve();
  }
}

const alice = Username.parse('alice');
const aHash = HashedPassword.parse('$6$testsalt$0123456789abcdefghijklmnopqrstuv');

function createUserCommand() {
  return {
    username: alice,
    email: EmailAddress.parse('alice@example.org'),
    accountType: AccountType.normal,
    quota: Quota.gib(412),
    proxyPort: ProxyPort.parse(8080),
    passwordHash: aHash,
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
    expect(await world.accounts.accountExists(alice)).toBe(true);
    expect(world.accounts.passwordWasSetFor(alice)).toBe(true);
    expect(world.quota.quotaOf(alice)?.toGib()).toBe(412);
    expect(await world.sftp.isChrootAccessEnabled(alice)).toBe(true);
    // Phase 0 does not provision rtorrent units — starting one is Phase 1's job
    expect(await world.services.isUserServiceRunning(alice)).toBe(false);
    expect(world.notifications.published).toEqual([{ type: 'UserCreated', username: 'alice' }]);
  });

  it('should_compensate_a_partial_failure_releasing_ports_and_account', async () => {
    world.quota.failNextSetQuota('quota tooling exploded');

    await expect(world.createUser.execute(createUserCommand())).rejects.toThrow(/exploded/);

    expect(await world.accounts.accountExists(alice)).toBe(false);
    expect(await world.repo.findByUsername(alice)).toBeUndefined();

    const retried = await world.createUser.execute(createUserCommand());
    expect(retried.scgiPort.value).toBe(51101); // released port is reusable
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
      username: Username.parse('bob'),
      email: EmailAddress.parse('bob@example.org'),
    });

    expect(second.scgiPort.equals(first.scgiPort)).toBe(false);
    expect(second.rtorrentPort.equals(first.rtorrentPort)).toBe(false);
  });
});

describe('DeleteUser', () => {
  it('should_tear_down_everything_and_notify', async () => {
    await world.createUser.execute(createUserCommand());

    await world.deleteUser.execute({ username: alice });

    expect(await world.accounts.accountExists(alice)).toBe(false);
    expect(await world.sftp.isChrootAccessEnabled(alice)).toBe(false);
    expect(await world.services.isUserServiceRunning(alice)).toBe(false);
    expect(await world.repo.findByUsername(alice)).toBeUndefined();
    expect(world.notifications.published.at(-1)).toEqual({
      type: 'UserDeleted',
      username: 'alice',
    });
  });

  it('should_reject_deleting_an_unknown_user', async () => {
    await expect(world.deleteUser.execute({ username: alice })).rejects.toThrow(UserNotFoundError);
  });
});

describe('ChangePassword', () => {
  it('should_set_the_system_password_and_notify', async () => {
    await world.createUser.execute(createUserCommand());

    await world.changePassword.execute({ username: alice, passwordHash: aHash });

    expect(world.notifications.published.at(-1)).toEqual({
      type: 'PasswordChanged',
      username: 'alice',
    });
  });

  it('should_reject_unknown_users', async () => {
    await expect(
      world.changePassword.execute({ username: alice, passwordHash: aHash }),
    ).rejects.toThrow(UserNotFoundError);
  });
});

describe('SuspendUser / ResumeUser', () => {
  it('should_suspend_reversibly_without_deleting_anything', async () => {
    await world.createUser.execute(createUserCommand());

    await world.suspendUser.execute({ username: alice });

    expect(await world.accounts.isLocked(alice)).toBe(true);
    expect(world.accounts.sessionsWereTerminatedFor(alice)).toBe(true); // live SSH cut
    expect(await world.sftp.isChrootAccessEnabled(alice)).toBe(false);
    expect(await world.services.isUserServiceRunning(alice)).toBe(false);
    expect(await world.accounts.accountExists(alice)).toBe(true); // nothing deleted
    expect((await world.repo.findByUsername(alice))?.status.isSuspended()).toBe(true);
    expect(world.quota.quotaOf(alice)?.toGib()).toBe(412); // quota untouched
    expect(world.notifications.published.at(-1)).toEqual({
      type: 'UserSuspended',
      username: 'alice',
    });
  });

  it('should_make_suspend_idempotent_and_convergent', async () => {
    await world.createUser.execute(createUserCommand());
    await world.suspendUser.execute({ username: alice });
    const notificationCount = world.notifications.published.length;

    await world.suspendUser.execute({ username: alice });

    expect(await world.accounts.isLocked(alice)).toBe(true);
    expect(world.notifications.published.length).toBe(notificationCount); // no duplicate event
  });

  it('should_resume_back_to_full_service', async () => {
    await world.createUser.execute(createUserCommand());
    await world.suspendUser.execute({ username: alice });

    await world.resumeUser.execute({ username: alice });

    expect(await world.accounts.isLocked(alice)).toBe(false);
    expect(await world.sftp.isChrootAccessEnabled(alice)).toBe(true);
    expect(await world.services.isUserServiceRunning(alice)).toBe(true);
    expect((await world.repo.findByUsername(alice))?.status.isSuspended()).toBe(false);
    expect(world.notifications.published.at(-1)).toEqual({
      type: 'UserResumed',
      username: 'alice',
    });
  });

  it('should_reject_suspending_an_unknown_user', async () => {
    await expect(world.suspendUser.execute({ username: alice })).rejects.toThrow(UserNotFoundError);
  });
});
