import { describe, expect, it } from 'vitest';
import { HashedPassword } from '../../../src/domain/user/HashedPassword.js';
import { Quota } from '../../../src/domain/user/Quota.js';
import { Username } from '../../../src/domain/user/Username.js';
import { InMemoryUserRepository } from '../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeNotifications } from '../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeQuota } from '../../../src/infrastructure/system/fakes/FakeQuota.js';
import { FakeServiceControl } from '../../../src/infrastructure/system/fakes/FakeServiceControl.js';
import { FakeSftp } from '../../../src/infrastructure/system/fakes/FakeSftp.js';
import { FakeSystemAccounts } from '../../../src/infrastructure/system/fakes/FakeSystemAccounts.js';
import { aUser } from '../../builders/UserBuilder.js';

const user-f = Username.parse('user-f');
const aHash = HashedPassword.parse('$6$testsalt$0123456789abcdefghijklmnopqrstuv');

describe('FakeSystemAccounts', () => {
  it('should_create_lock_unlock_and_delete_accounts', async () => {
    const accounts = new FakeSystemAccounts();

    await accounts.createAccount(user-f);
    expect(await accounts.accountExists(user-f)).toBe(true);
    expect(await accounts.isLocked(user-f)).toBe(true); // Debian: no password yet

    await accounts.setPassword(user-f, aHash);
    expect(await accounts.isLocked(user-f)).toBe(false);

    await accounts.lockAccount(user-f);
    expect(await accounts.isLocked(user-f)).toBe(true);

    await accounts.unlockAccount(user-f);
    expect(await accounts.isLocked(user-f)).toBe(false);

    await accounts.deleteAccount(user-f);
    expect(await accounts.accountExists(user-f)).toBe(false);
  });

  it('should_reject_creating_a_duplicate_account', async () => {
    const accounts = new FakeSystemAccounts();
    await accounts.createAccount(user-f);

    await expect(accounts.createAccount(user-f)).rejects.toThrow(/already exists/);
  });

  it('should_reject_operations_on_missing_accounts', async () => {
    const accounts = new FakeSystemAccounts();

    await expect(accounts.lockAccount(user-f)).rejects.toThrow(/does not exist/);
    await expect(accounts.setPassword(user-f, aHash)).rejects.toThrow(/does not exist/);
  });

  it('should_record_that_a_password_hash_was_set', async () => {
    const accounts = new FakeSystemAccounts();
    await accounts.createAccount(user-f);

    await accounts.setPassword(user-f, aHash);

    expect(accounts.passwordWasSetFor(user-f)).toBe(true);
  });
});

describe('FakeQuota', () => {
  it('should_store_quota_and_report_usage_zero_by_default', async () => {
    const quota = new FakeQuota();

    await quota.setQuota(user-f, Quota.gib(412));

    expect(quota.quotaOf(user-f)?.toGib()).toBe(412);
    expect((await quota.getUsage(user-f)).toBytes()).toBe(0);
  });
});

describe('FakeSftp', () => {
  it('should_toggle_chroot_access_idempotently', async () => {
    const sftp = new FakeSftp();

    await sftp.enableChrootAccess(user-f);
    await sftp.enableChrootAccess(user-f);
    expect(await sftp.isChrootAccessEnabled(user-f)).toBe(true);

    await sftp.disableChrootAccess(user-f);
    expect(await sftp.isChrootAccessEnabled(user-f)).toBe(false);
  });
});

describe('FakeServiceControl', () => {
  it('should_track_per_user_service_state', async () => {
    const services = new FakeServiceControl();

    await services.startUserService(user-f);
    expect(await services.isUserServiceRunning(user-f)).toBe(true);

    await services.stopUserService(user-f);
    expect(await services.isUserServiceRunning(user-f)).toBe(false);
  });
});

describe('FakeNotifications', () => {
  it('should_record_published_events', async () => {
    const notifications = new FakeNotifications();

    await notifications.notify({ type: 'UserCreated', username: 'user-f' });

    expect(notifications.published).toEqual([{ type: 'UserCreated', username: 'user-f' }]);
  });
});

describe('InMemoryUserRepository', () => {
  it('should_save_assigning_an_id_and_find_by_username', async () => {
    const repo = new InMemoryUserRepository();

    const saved = await repo.save(aUser().build());

    expect(saved.id?.value).toBe(1);
    const found = await repo.findByUsername(saved.username);
    expect(found?.username.equals(saved.username)).toBe(true);
  });

  it('should_update_in_place_when_saving_an_identified_user', async () => {
    const repo = new InMemoryUserRepository();
    const saved = await repo.save(aUser().build());

    const suspended = saved.suspend().user;
    const updated = await repo.save(suspended);

    expect(updated.id?.value).toBe(saved.id?.value);
    expect((await repo.listAll()).length).toBe(1);
    expect((await repo.findByUsername(saved.username))?.status.isSuspended()).toBe(true);
  });

  it('should_delete_by_username', async () => {
    const repo = new InMemoryUserRepository();
    const saved = await repo.save(aUser().build());

    await repo.delete(saved.username);

    expect(await repo.findByUsername(saved.username)).toBeUndefined();
  });
});
