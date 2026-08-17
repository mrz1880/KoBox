import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { AuthorizedKeysPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// sshd refuses to read authorized_keys unless the file and its directory belong
// to the member and are not group- or world-writable, so ownership is part of
// the write, not an afterthought.
export class AuthorizedKeysAdapter implements AuthorizedKeysPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly files: ManagedFilesPort,
  ) {}

  async write(username: Username, line: string): Promise<void> {
    const home = `/home/${username.value}`;
    await runOrThrow(this.runner, {
      command: 'install',
      args: ['-d', '-m', '0700', '-o', username.value, '-g', username.value, `${home}/.ssh`],
    });
    await this.files.apply([
      {
        path: `${home}/.ssh/authorized_keys`,
        content: `${line}\n`,
        mode: '0600',
        owner: username.value,
        group: username.value,
      },
    ]);
  }

  async clear(username: Username): Promise<void> {
    // an empty file rather than a missing one: sshd treats both the same, and
    // a file that exists says the feature was used and then turned off
    await this.files.apply([
      {
        path: `/home/${username.value}/.ssh/authorized_keys`,
        content: '',
        mode: '0600',
        owner: username.value,
        group: username.value,
      },
    ]);
  }
}
