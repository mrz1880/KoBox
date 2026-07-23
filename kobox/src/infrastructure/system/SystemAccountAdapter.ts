import type { HashedPassword } from '../../domain/user/HashedPassword.js';
import type { SystemAccountPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

export const KOBOX_USERS_GROUP = 'kobox-users';

export class SystemAccountAdapter implements SystemAccountPort {
  constructor(private readonly runner: CommandRunner) {}

  async createAccount(username: Username): Promise<void> {
    await runOrThrow(this.runner, { command: 'groupadd', args: ['-f', KOBOX_USERS_GROUP] });
    await runOrThrow(this.runner, {
      command: 'useradd',
      args: ['-m', '-s', '/bin/bash', '-G', KOBOX_USERS_GROUP, username.value],
    });
  }

  async deleteAccount(username: Username): Promise<void> {
    await runOrThrow(this.runner, { command: 'userdel', args: ['-r', username.value] });
  }

  async setPassword(username: Username, hash: HashedPassword): Promise<void> {
    // stdin keeps the hash out of argv (visible in /proc while running)
    await runOrThrow(this.runner, {
      command: 'chpasswd',
      args: ['-e'],
      stdin: `${username.value}:${hash.value}\n`,
    });
  }

  async lockAccount(username: Username): Promise<void> {
    await runOrThrow(this.runner, { command: 'usermod', args: ['-L', username.value] });
  }

  async unlockAccount(username: Username): Promise<void> {
    await runOrThrow(this.runner, { command: 'usermod', args: ['-U', username.value] });
  }

  async accountExists(username: Username): Promise<boolean> {
    const result = await this.runner.run({ command: 'id', args: ['-u', username.value] });
    return result.exitCode === 0;
  }

  async isLocked(username: Username): Promise<boolean> {
    const result = await runOrThrow(this.runner, {
      command: 'passwd',
      args: ['-S', username.value],
    });
    return result.stdout.split(/\s+/)[1]?.startsWith('L') ?? false;
  }
}
