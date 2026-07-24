import type { UserIdentityPort } from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { CommandRunner } from './CommandRunner.js';

export class GetentUserIdentityAdapter implements UserIdentityPort {
  constructor(private readonly runner: CommandRunner) {}

  async uidOf(username: Username): Promise<number | undefined> {
    const result = await this.runner.run({
      command: 'getent',
      args: ['passwd', username.value],
      timeoutMs: 5_000,
    });
    if (result.exitCode !== 0) {
      return undefined;
    }
    const uidField = result.stdout.trim().split(':')[2];
    const uid = Number(uidField);
    return Number.isInteger(uid) ? uid : undefined;
  }
}
