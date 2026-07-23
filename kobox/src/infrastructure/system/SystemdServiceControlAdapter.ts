import type { ServiceControlPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

function unitOf(username: Username): string {
  return `rtorrent-${username.value}`;
}

export class SystemdServiceControlAdapter implements ServiceControlPort {
  constructor(private readonly runner: CommandRunner) {}

  async stopUserService(username: Username): Promise<void> {
    await runOrThrow(this.runner, { command: 'systemctl', args: ['stop', unitOf(username)] });
  }

  async startUserService(username: Username): Promise<void> {
    await runOrThrow(this.runner, { command: 'systemctl', args: ['start', unitOf(username)] });
  }

  async isUserServiceRunning(username: Username): Promise<boolean> {
    const result = await this.runner.run({
      command: 'systemctl',
      args: ['is-active', '--quiet', unitOf(username)],
    });
    return result.exitCode === 0;
  }
}
