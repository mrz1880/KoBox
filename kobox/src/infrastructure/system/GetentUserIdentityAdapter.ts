import type { AccountIds, UserIdentityPort } from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { CommandRunner } from './CommandRunner.js';

export class GetentUserIdentityAdapter implements UserIdentityPort {
  constructor(private readonly runner: CommandRunner) {}

  async uidOf(username: Username): Promise<number | undefined> {
    return (await this.idsOf(username))?.uid;
  }

  async idsOf(username: Username): Promise<AccountIds | undefined> {
    const result = await this.runner.run({
      command: 'getent',
      args: ['passwd', username.value],
      timeoutMs: 5_000,
    });
    if (result.exitCode !== 0) {
      return undefined;
    }
    // name:password:uid:gid:gecos:home:shell
    const [, , uidField, gidField] = result.stdout.trim().split(':');
    const uid = Number(uidField);
    const gid = Number(gidField);
    return Number.isInteger(uid) && Number.isInteger(gid) ? { uid, gid } : undefined;
  }
}
