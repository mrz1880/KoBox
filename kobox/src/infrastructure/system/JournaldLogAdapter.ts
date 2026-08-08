import type { ServiceLogPort } from '../../application/maintenance/DiagnosticsPort.js';
import type { LoggableService } from '../../domain/maintenance/ManagedService.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// journalctl on ONE unit, never the whole journal. The unit name arrives as a
// closed-set value object, and argv-only execution means it can never become a
// second argument or a shell fragment.
export class JournaldLogAdapter implements ServiceLogPort {
  constructor(private readonly runner: CommandRunner) {}

  async tail(service: LoggableService, lines: number): Promise<string> {
    const result = await runOrThrow(this.runner, {
      command: 'journalctl',
      args: ['-u', service.value, '-n', String(lines), '--no-pager', '--output=short-iso'],
      timeoutMs: 30_000,
    });
    return result.stdout;
  }
}
