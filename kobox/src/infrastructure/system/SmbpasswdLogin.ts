import type { Password } from '../../domain/user/Password.js';
import type { ServiceLoginPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// Samba authenticates with an NT hash it derives from the clear password, so it
// keeps its own account database (the tdb) and cannot reuse the shadow hash.
export class SmbpasswdLogin implements ServiceLoginPort {
  constructor(private readonly runner: CommandRunner) {}

  async setPassword(username: Username, password: Password): Promise<void> {
    // -s: the new password and its confirmation as two stdin lines; -a: add or
    // update. Never an argv, which every user can read in /proc.
    await runOrThrow(this.runner, {
      command: 'smbpasswd',
      args: ['-s', '-a', username.value],
      stdin: `${password.reveal()}\n${password.reveal()}\n`,
    });
  }

  async remove(username: Username): Promise<void> {
    // smbpasswd -x fails on an account it does not hold
    const listed = await runOrThrow(this.runner, { command: 'pdbedit', args: ['-L'] });
    const holds = listed.stdout
      .split('\n')
      .some((line) => line.split(':')[0] === username.value);
    if (holds) {
      await runOrThrow(this.runner, { command: 'smbpasswd', args: ['-x', username.value] });
    }
  }
}
