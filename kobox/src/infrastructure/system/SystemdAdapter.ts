import type { SystemdPort } from '../../domain/installation/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const SYSTEMCTL_TIMEOUT_MS = 60_000;

export class SystemdAdapter implements SystemdPort {
  constructor(private readonly runner: CommandRunner) {}

  async daemonReload(): Promise<void> {
    await this.systemctl(['daemon-reload']);
  }

  async enable(unit: string, opts?: { readonly now?: boolean }): Promise<void> {
    await this.systemctl(opts?.now === true ? ['enable', '--now', unit] : ['enable', unit]);
  }

  // disable tolerates absent units: teardown must converge on a box where a
  // component never finished installing
  async disable(unit: string, opts?: { readonly now?: boolean }): Promise<void> {
    await this.runner.run({
      command: 'systemctl',
      args: opts?.now === true ? ['disable', '--now', unit] : ['disable', unit],
      timeoutMs: SYSTEMCTL_TIMEOUT_MS,
    });
  }

  async start(unit: string): Promise<void> {
    await this.systemctl(['start', unit]);
  }

  async stop(unit: string): Promise<void> {
    await this.systemctl(['stop', unit]);
  }

  async reloadOrRestart(unit: string): Promise<void> {
    await this.systemctl(['reload-or-restart', unit]);
  }

  async isActive(unit: string): Promise<boolean> {
    const result = await this.runner.run({
      command: 'systemctl',
      args: ['is-active', '--quiet', unit],
      timeoutMs: SYSTEMCTL_TIMEOUT_MS,
    });
    return result.exitCode === 0;
  }

  private async systemctl(args: readonly string[]): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'systemctl',
      args: [...args],
      timeoutMs: SYSTEMCTL_TIMEOUT_MS,
    });
  }
}
