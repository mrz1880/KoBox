import type { KernelSettingsPort } from '../../application/user/ReserveMemberPorts.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// sysctl -p loads exactly the file it is given, unlike --system, which rereads
// every drop-in on the host.
export class SysctlAdapter implements KernelSettingsPort {
  constructor(private readonly runner: CommandRunner) {}

  async load(path: string): Promise<void> {
    await runOrThrow(this.runner, { command: 'sysctl', args: ['-q', '-p', path] });
  }
}
