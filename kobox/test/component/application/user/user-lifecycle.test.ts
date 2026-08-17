import { beforeEach, describe, expect, it } from 'vitest';
import { ChangePassword } from '../../../../src/application/user/ChangePassword.js';
import { CreateUser } from '../../../../src/application/user/CreateUser.js';
import { DeleteUser } from '../../../../src/application/user/DeleteUser.js';
import { ResumeUser } from '../../../../src/application/user/ResumeUser.js';
import { SampleDiskUsage } from '../../../../src/application/user/SampleDiskUsage.js';
import { SetUserQuota } from '../../../../src/application/user/SetUserQuota.js';
import { SuspendUser } from '../../../../src/application/user/SuspendUser.js';
import {
  RestartRtorrentInstance,
  SuspendedUserRestartError,
} from '../../../../src/application/torrent/RestartRtorrentInstance.js';
import {
  UserAlreadyExistsError,
  UserNotFoundError,
} from '../../../../src/application/user/errors.js';
import { AccountType } from '../../../../src/domain/user/AccountType.js';
import { EmailAddress } from '../../../../src/domain/user/EmailAddress.js';
import { HashedPassword } from '../../../../src/domain/user/HashedPassword.js';
import { ProxyPort, RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import type { PortAllocatorPort } from '../../../../src/domain/user/PortAllocatorPort.js';
import { PortAlreadyClaimedError } from '../../../../src/domain/user/PortAllocatorPort.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemoryDebridAccountRepository } from '../../../../src/infrastructure/persistence/InMemoryDebridAccountRepository.js';
import { InMemoryPortalSessionRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalSessionRepository.js';
import { InMemoryDiskUsageRepository } from '../../../../src/infrastructure/persistence/InMemoryDiskUsageRepository.js';
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
  private readonly claimed = new Set<number>();

  allocateScgiPort(): Promise<ScgiPort> {
    const freed = this.freedScgi.shift();
    if (freed !== undefined) {
      return Promise.resolve(ScgiPort.parse(freed));
    }
    while (this.claimed.has(this.nextScgi)) {
      this.nextScgi += 1;
    }
    return Promise.resolve(ScgiPort.parse(this.nextScgi++));
  }

  allocateRtorrentPort(): Promise<RtorrentPort> {
    const freed = this.freedRtorrent.shift();
    if (freed !== undefined) {
      return Promise.resolve(RtorrentPort.parse(freed));
    }
    while (this.claimed.has(this.nextRtorrent)) {
      this.nextRtorrent += 1;
    }
    return Promise.resolve(RtorrentPort.parse(this.nextRtorrent++));
  }

  releaseScgiPort(port: ScgiPort): Promise<void> {
    this.claimed.delete(port.value);
    this.freedScgi.push(port.value);
    return Promise.resolve();
  }

  releaseRtorrentPort(port: RtorrentPort): Promise<void> {
    this.claimed.delete(port.value);
    this.freedRtorrent.push(port.value);
    return Promise.resolve();
  }

  claimScgiPort(port: ScgiPort): Promise<void> {
    return this.claim(port.value);
  }

  claimRtorrentPort(port: RtorrentPort): Promise<void> {
    return this.claim(port.value);
  }

  private claim(value: number): Promise<void> {
    if (this.claimed.has(value)) {
      return Promise.reject(new PortAlreadyClaimedError(value));
    }
    this.claimed.add(value);
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
    role: 'user' as const,
  };
}

interface World {
  repo: InMemoryUserRepository;
  accounts: FakeSystemAccounts;
  quota: FakeQuota;
  sftp: FakeSftp;
  services: FakeServiceControl;
  notifications: FakeNotifications;
  credentials: InMemoryPortalCredentialsRepository;
  sessions: InMemoryPortalSessionRepository;
  debridAccounts: InMemoryDebridAccountRepository;
  createUser: CreateUser;
  deleteUser: DeleteUser;
  changePassword: ChangePassword;
  suspendUser: SuspendUser;
  resumeUser: ResumeUser;
  setUserQuota: SetUserQuota;
  sampleDiskUsage: SampleDiskUsage;
  diskSamples: InMemoryDiskUsageRepository;
}

let world: World;

beforeEach(() => {
  const repo = new InMemoryUserRepository();
  const accounts = new FakeSystemAccounts();
  const quota = new FakeQuota();
  const sftp = new FakeSftp();
  const services = new FakeServiceControl();
  const notifications = new FakeNotifications();
  const credentials = new InMemoryPortalCredentialsRepository();
  const sessions = new InMemoryPortalSessionRepository();
  const debridAccounts = new InMemoryDebridAccountRepository();
  const diskSamples = new InMemoryDiskUsageRepository();
  const allocator = new SequentialPortAllocator();
  const clock = (): string => '2026-07-25 10:00:00';
  const deps = {
    repo, accounts, quota, sftp, services, notifications, credentials, sessions,
    debridAccounts, clock,
  };
  world = {
    ...deps,
    createUser: new CreateUser({ ...deps, allocator }),
    deleteUser: new DeleteUser(deps),
    changePassword: new ChangePassword(deps),
    suspendUser: new SuspendUser(deps),
    resumeUser: new ResumeUser(deps),
    setUserQuota: new SetUserQuota(deps),
    sampleDiskUsage: new SampleDiskUsage({ ...deps, samples: diskSamples }),
    diskSamples,
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

  it('should_store_portal_credentials_with_the_requested_role', async () => {
    await world.createUser.execute({ ...createUserCommand(), role: 'admin' });

    const credentials = await world.credentials.find(alice);
    expect(credentials?.passwordHash.value).toBe(aHash.value);
    expect(credentials?.role).toBe('admin');
  });

  it('should_flag_an_imported_user_for_a_forced_password_change', async () => {
    await world.createUser.execute({ ...createUserCommand(), mustChangePassword: true });

    expect((await world.credentials.find(alice))?.mustChangePassword).toBe(true);
  });

  it('should_not_flag_a_normal_user_for_a_forced_password_change', async () => {
    await world.createUser.execute(createUserCommand());

    expect((await world.credentials.find(alice))?.mustChangePassword).toBe(false);
  });

  it('should_not_leave_portal_credentials_behind_after_a_compensated_failure', async () => {
    world.quota.failNextSetQuota('quota tooling exploded');

    await expect(world.createUser.execute(createUserCommand())).rejects.toThrow(/exploded/);

    expect(await world.credentials.find(alice)).toBeUndefined();
  });

  it('should_preserve_explicit_ports_when_importing_a_legacy_user', async () => {
    const user = await world.createUser.execute({
      ...createUserCommand(),
      ports: { scgi: ScgiPort.parse(51110), rtorrent: RtorrentPort.parse(45010) },
    });

    expect(user.scgiPort.value).toBe(51110);
    expect(user.rtorrentPort.value).toBe(45010);
    // the claimed ports are off the table for the next fresh allocation
    const next = await world.createUser.execute({
      ...createUserCommand(),
      username: Username.parse('bob'),
      email: EmailAddress.parse('bob@example.org'),
    });
    expect(next.scgiPort.value).not.toBe(51110);
  });

  it('should_reject_importing_a_user_onto_an_already_claimed_port', async () => {
    await world.createUser.execute({
      ...createUserCommand(),
      ports: { scgi: ScgiPort.parse(51110), rtorrent: RtorrentPort.parse(45010) },
    });

    await expect(
      world.createUser.execute({
        ...createUserCommand(),
        username: Username.parse('bob'),
        email: EmailAddress.parse('bob@example.org'),
        ports: { scgi: ScgiPort.parse(51110), rtorrent: RtorrentPort.parse(45011) },
      }),
    ).rejects.toThrow(PortAlreadyClaimedError);
    // compensation: the collided import left no system account behind
    expect(await world.accounts.accountExists(Username.parse('bob'))).toBe(false);
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

describe('RestartRtorrentInstance', () => {
  it('should_restart_the_instance_of_an_active_user', async () => {
    await world.createUser.execute(createUserCommand());
    const restart = new RestartRtorrentInstance({ users: world.repo, services: world.services });

    await restart.execute({ username: alice });

    expect(await world.services.isUserServiceRunning(alice)).toBe(true);
  });

  it('should_refuse_a_suspended_user_so_the_sanction_is_not_undone', async () => {
    await world.createUser.execute(createUserCommand());
    await world.suspendUser.execute({ username: alice });
    const restart = new RestartRtorrentInstance({ users: world.repo, services: world.services });

    await expect(restart.execute({ username: alice })).rejects.toThrow(SuspendedUserRestartError);
    expect(await world.services.isUserServiceRunning(alice)).toBe(false);
  });

  it('should_reject_an_unknown_user', async () => {
    const restart = new RestartRtorrentInstance({ users: world.repo, services: world.services });

    await expect(restart.execute({ username: alice })).rejects.toThrow(UserNotFoundError);
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

  it('should_remove_portal_credentials_and_sessions', async () => {
    await world.createUser.execute(createUserCommand());
    await world.sessions.create({
      id: 'a'.repeat(64),
      username: alice,
      csrfToken: 'b'.repeat(64),
      createdAt: '2026-07-25 10:00:00',
      expiresAt: '2026-08-01 10:00:00',
    });

    await world.deleteUser.execute({ username: alice });

    expect(await world.credentials.find(alice)).toBeUndefined();
    expect(await world.sessions.find('a'.repeat(64))).toBeUndefined();
  });

  it('should_not_let_a_stored_debrid_key_outlive_the_account', async () => {
    await world.createUser.execute(createUserCommand());
    await world.debridAccounts.save(alice, 'sealed-blob', '2026-07-30 12:00:00');

    await world.deleteUser.execute({ username: alice });

    expect(await world.debridAccounts.has(alice)).toBe(false);
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

  it('should_update_the_portal_credential_hash_preserving_the_role', async () => {
    await world.createUser.execute({ ...createUserCommand(), role: 'admin' });
    const newHash = HashedPassword.parse('$6$newsalt00$abcdefghijklmnopqrstuvwxyz012345');

    await world.changePassword.execute({ username: alice, passwordHash: newHash });

    const credentials = await world.credentials.find(alice);
    expect(credentials?.passwordHash.value).toBe(newHash.value);
    expect(credentials?.role).toBe('admin');
  });

  it('should_revoke_live_sessions_so_a_stolen_cookie_dies_with_the_password', async () => {
    await world.createUser.execute(createUserCommand());
    await world.sessions.create({
      id: 'a'.repeat(64),
      username: alice,
      csrfToken: 'b'.repeat(64),
      createdAt: '2026-07-25 10:00:00',
      expiresAt: '2026-08-01 10:00:00',
    });

    await world.changePassword.execute({ username: alice, passwordHash: aHash });

    expect(await world.sessions.find('a'.repeat(64))).toBeUndefined();
  });

  it('should_create_portal_credentials_for_a_user_predating_the_portal', async () => {
    await world.createUser.execute(createUserCommand());
    await world.credentials.delete(alice); // simulate a pre-Phase-6 row

    await world.changePassword.execute({ username: alice, passwordHash: aHash });

    expect((await world.credentials.find(alice))?.role).toBe('user');
  });

  it('should_clear_the_must_change_flag_once_the_password_is_changed', async () => {
    await world.createUser.execute({ ...createUserCommand(), mustChangePassword: true });

    await world.changePassword.execute({ username: alice, passwordHash: aHash });

    expect((await world.credentials.find(alice))?.mustChangePassword).toBe(false);
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

  it('should_kill_live_portal_sessions_on_suspend', async () => {
    await world.createUser.execute(createUserCommand());
    await world.sessions.create({
      id: 'a'.repeat(64),
      username: alice,
      csrfToken: 'b'.repeat(64),
      createdAt: '2026-07-25 10:00:00',
      expiresAt: '2026-08-01 10:00:00',
    });

    await world.suspendUser.execute({ username: alice });

    expect(await world.sessions.find('a'.repeat(64))).toBeUndefined();
  });

  it('should_reject_suspending_an_unknown_user', async () => {
    await expect(world.suspendUser.execute({ username: alice })).rejects.toThrow(UserNotFoundError);
  });
});

describe('SetUserQuota', () => {
  it('should_change_one_member_allowance_on_the_account_and_on_the_filesystem', async () => {
    await world.createUser.execute(createUserCommand());

    await world.setUserQuota.execute({ username: alice, quota: Quota.gib(900) });

    expect((await world.repo.findByUsername(alice))?.quota.toGib()).toBe(900);
    expect(world.quota.quotaOf(alice)?.toGib()).toBe(900);
  });

  it('should_leave_every_other_member_allowance_untouched', async () => {
    // the report behind this feature said adding or changing one member updated
    // everyone. Nothing in the code did that; this is what keeps it that way.
    const bob = Username.parse('bob');
    await world.createUser.execute(createUserCommand());
    await world.createUser.execute({
      ...createUserCommand(),
      username: bob,
      email: EmailAddress.parse('bob@example.org'),
      quota: Quota.gib(200),
    });

    await world.setUserQuota.execute({ username: alice, quota: Quota.gib(900) });

    expect((await world.repo.findByUsername(bob))?.quota.toGib()).toBe(200);
    expect(world.quota.quotaOf(bob)?.toGib()).toBe(200);
  });

  it('should_refuse_a_member_that_does_not_exist', async () => {
    await expect(
      world.setUserQuota.execute({ username: alice, quota: Quota.gib(900) }),
    ).rejects.toThrow(UserNotFoundError);
  });
});

describe('SampleDiskUsage', () => {
  it('should_record_what_the_disk_actually_holds_for_each_member', async () => {
    // the portal runs non-root and cannot ask the disk about another account,
    // so somebody privileged has to look and write the answer down
    await world.createUser.execute(createUserCommand());
    world.quota.setUsageForTest(alice, Quota.gib(37));

    await world.sampleDiskUsage.execute();

    const sample = await world.diskSamples.find(alice);
    expect(sample?.used.toGib()).toBe(37);
    expect(sample?.sampledAt).toBe('2026-07-25 10:00:00');
  });
});
