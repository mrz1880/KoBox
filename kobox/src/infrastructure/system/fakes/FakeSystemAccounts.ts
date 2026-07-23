import type { HashedPassword } from '../../../domain/user/HashedPassword.js';
import type { SystemAccountPort } from '../../../domain/user/ports.js';
import type { Username } from '../../../domain/user/Username.js';

interface FakeAccount {
  locked: boolean;
  hasPassword: boolean;
}

export class FakeSystemAccounts implements SystemAccountPort {
  private readonly accounts = new Map<string, FakeAccount>();

  createAccount(username: Username): Promise<void> {
    if (this.accounts.has(username.value)) {
      return Promise.reject(new Error(`account ${username.value} already exists`));
    }
    this.accounts.set(username.value, { locked: false, hasPassword: false });
    return Promise.resolve();
  }

  deleteAccount(username: Username): Promise<void> {
    return this.withAccount(username, () => {
      this.accounts.delete(username.value);
    });
  }

  setPassword(username: Username, hash: HashedPassword): Promise<void> {
    return this.withAccount(username, (account) => {
      account.hasPassword = hash.value.length > 0;
    });
  }

  lockAccount(username: Username): Promise<void> {
    return this.withAccount(username, (account) => {
      account.locked = true;
    });
  }

  unlockAccount(username: Username): Promise<void> {
    return this.withAccount(username, (account) => {
      account.locked = false;
    });
  }

  accountExists(username: Username): Promise<boolean> {
    return Promise.resolve(this.accounts.has(username.value));
  }

  isLocked(username: Username): Promise<boolean> {
    const account = this.accounts.get(username.value);
    if (!account) {
      return Promise.reject(new Error(`account ${username.value} does not exist`));
    }
    return Promise.resolve(account.locked);
  }

  passwordWasSetFor(username: Username): boolean {
    return this.accounts.get(username.value)?.hasPassword ?? false;
  }

  private withAccount(username: Username, mutate: (account: FakeAccount) => void): Promise<void> {
    const account = this.accounts.get(username.value);
    if (!account) {
      return Promise.reject(new Error(`account ${username.value} does not exist`));
    }
    mutate(account);
    return Promise.resolve();
  }
}
