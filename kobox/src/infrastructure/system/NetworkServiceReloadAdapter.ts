import type { NetworkServiceReloadPort } from '../../domain/tracker/ports.js';
import type { Logger } from '../logging/logger.js';
import type { CommandRequest, CommandRunner } from './CommandRunner.js';

// Phase 3 (Security & Network) will own these services; until then the files
// are the truth and reloads are best-effort — a missing binary or inactive
// unit must never fail a render job.
export class NetworkServiceReloadAdapter implements NetworkServiceReloadPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly logger: Logger,
  ) {}

  async reloadDns(): Promise<void> {
    await this.tryRun({ command: 'rndc', args: ['reload'] });
    await this.tryRun({ command: 'systemctl', args: ['try-restart', 'dnscrypt-proxy'] });
  }

  async reloadPeerGuardian(): Promise<void> {
    await this.tryRun({ command: 'pglcmd', args: ['reload'] });
  }

  private async tryRun(request: CommandRequest): Promise<void> {
    try {
      const result = await this.runner.run(request);
      if (result.exitCode !== 0) {
        this.logger.warn(
          { command: request.command, stderr: result.stderr },
          'network service reload failed (best-effort)',
        );
      }
    } catch (error) {
      this.logger.warn(
        { command: request.command, error },
        'network service reload failed (best-effort)',
      );
    }
  }
}
