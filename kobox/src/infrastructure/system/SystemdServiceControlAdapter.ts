import type { ServiceControlPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { CommandFailedError, type CommandRunner } from './CommandRunner.js';

function unitOf(username: Username): string {
  return `rtorrent-${username.value}`;
}

export class SystemdServiceControlAdapter implements ServiceControlPort {
  constructor(private readonly runner: CommandRunner) {}

  // exit 5 = unit not loaded: tolerated because Phase 0 does not provision the
  // rtorrent units yet (Phase 1 does) — suspend/delete must still converge.
  async stopUserService(username: Username): Promise<void> {
    await this.runToleratingMissingUnit('stop', username);
  }

  async startUserService(username: Username): Promise<void> {
    await this.runToleratingMissingUnit('start', username);
  }

  private async runToleratingMissingUnit(verb: 'stop' | 'start', username: Username): Promise<void> {
    const request = { command: 'systemctl', args: [verb, unitOf(username)] };
    const result = await this.runner.run(request);
    if (result.exitCode !== 0 && result.exitCode !== 5) {
      throw new CommandFailedError(request, result);
    }
  }

  async isUserServiceRunning(username: Username): Promise<boolean> {
    const result = await this.runner.run({
      command: 'systemctl',
      args: ['is-active', '--quiet', unitOf(username)],
    });
    return result.exitCode === 0;
  }
}
