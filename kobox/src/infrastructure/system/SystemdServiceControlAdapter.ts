import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceControlPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { CommandFailedError, runOrThrow, type CommandRunner } from './CommandRunner.js';

function unitOf(username: Username): string {
  return `rtorrent-${username.value}`;
}

export class SystemdServiceControlAdapter implements ServiceControlPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly unitDir = '/etc/systemd/system',
  ) {}

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

  // Declarative and idempotent: identical content means zero side effects
  // (no write, no daemon-reload — no churn on every render like the legacy).
  async installUserService(username: Username, unitContent: string): Promise<void> {
    const path = this.unitPath(username);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (existing === unitContent) {
      return;
    }
    mkdirSync(this.unitDir, { recursive: true });
    const temp = `${path}.kobox-tmp`;
    writeFileSync(temp, unitContent);
    renameSync(temp, path);
    await runOrThrow(this.runner, { command: 'systemctl', args: ['daemon-reload'] });
    await runOrThrow(this.runner, { command: 'systemctl', args: ['enable', unitOf(username)] });
  }

  async removeUserService(username: Username): Promise<void> {
    // nonzero tolerated: a missing or already-disabled unit must converge
    await this.runner.run({
      command: 'systemctl',
      args: ['disable', '--now', unitOf(username)],
    });
    rmSync(this.unitPath(username), { force: true });
    await runOrThrow(this.runner, { command: 'systemctl', args: ['daemon-reload'] });
  }

  async restartUserService(username: Username): Promise<void> {
    await runOrThrow(this.runner, { command: 'systemctl', args: ['restart', unitOf(username)] });
  }

  private unitPath(username: Username): string {
    return join(this.unitDir, `${unitOf(username)}.service`);
  }
}
