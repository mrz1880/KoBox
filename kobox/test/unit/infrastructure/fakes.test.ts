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

const alice = Username.parse('alice');
const aHash = HashedPassword.parse('$6$testsalt$0123456789abcdefghijklmnopqrstuv');

describe('FakeSystemAccounts', () => {
  it('should_create_lock_unlock_and_delete_accounts', async () => {
    const accounts = new FakeSystemAccounts();

    await accounts.createAccount(alice);
    expect(await accounts.accountExists(alice)).toBe(true);
    expect(await accounts.isLocked(alice)).toBe(true); // Debian: no password yet

    await accounts.setPassword(alice, aHash);
    expect(await accounts.isLocked(alice)).toBe(false);

    await accounts.lockAccount(alice);
    expect(await accounts.isLocked(alice)).toBe(true);

    await accounts.unlockAccount(alice);
    expect(await accounts.isLocked(alice)).toBe(false);

    await accounts.deleteAccount(alice);
    expect(await accounts.accountExists(alice)).toBe(false);
  });

  it('should_reject_creating_a_duplicate_account', async () => {
    const accounts = new FakeSystemAccounts();
    await accounts.createAccount(alice);

    await expect(accounts.createAccount(alice)).rejects.toThrow(/already exists/);
  });

  it('should_reject_operations_on_missing_accounts', async () => {
    const accounts = new FakeSystemAccounts();

    await expect(accounts.lockAccount(alice)).rejects.toThrow(/does not exist/);
    await expect(accounts.setPassword(alice, aHash)).rejects.toThrow(/does not exist/);
  });

  it('should_record_that_a_password_hash_was_set', async () => {
    const accounts = new FakeSystemAccounts();
    await accounts.createAccount(alice);

    await accounts.setPassword(alice, aHash);

    expect(accounts.passwordWasSetFor(alice)).toBe(true);
  });
});

describe('FakeQuota', () => {
  it('should_store_quota_and_report_usage_zero_by_default', async () => {
    const quota = new FakeQuota();

    await quota.setQuota(alice, Quota.gib(412));

    expect(quota.quotaOf(alice)?.toGib()).toBe(412);
    expect((await quota.getUsage(alice)).toBytes()).toBe(0);
  });
});

describe('FakeSftp', () => {
  it('should_toggle_chroot_access_idempotently', async () => {
    const sftp = new FakeSftp();

    await sftp.enableChrootAccess(alice);
    await sftp.enableChrootAccess(alice);
    expect(await sftp.isChrootAccessEnabled(alice)).toBe(true);

    await sftp.disableChrootAccess(alice);
    expect(await sftp.isChrootAccessEnabled(alice)).toBe(false);
  });
});

describe('FakeServiceControl', () => {
  it('should_track_per_user_service_state', async () => {
    const services = new FakeServiceControl();

    await services.startUserService(alice);
    expect(await services.isUserServiceRunning(alice)).toBe(true);

    await services.stopUserService(alice);
    expect(await services.isUserServiceRunning(alice)).toBe(false);
  });
});

describe('FakeNotifications', () => {
  it('should_record_published_events', async () => {
    const notifications = new FakeNotifications();

    await notifications.notify({ type: 'UserCreated', username: 'alice' });

    expect(notifications.published).toEqual([{ type: 'UserCreated', username: 'alice' }]);
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
