import type { ConfigCheckPort, ConfigCheckResult } from '../../domain/installation/ports.js';
import type { CommandRunner } from './CommandRunner.js';

const CHECK_TIMEOUT_MS = 30_000;

// Service-native validators — the guard half of guardedApply. A non-zero
// exit turns into {ok:false, detail} so the installer can roll back and the
// registry records WHY.
export class ConfigCheckAdapter implements ConfigCheckPort {
  constructor(private readonly runner: CommandRunner) {}

  sshd(): Promise<ConfigCheckResult> {
    return this.check('sshd', ['-t']);
  }

  nginx(): Promise<ConfigCheckResult> {
    return this.check('nginx', ['-t']);
  }

  bind(): Promise<ConfigCheckResult> {
    return this.check('named-checkconf', []);
  }

  private async check(command: string, args: readonly string[]): Promise<ConfigCheckResult> {
    const result = await this.runner.run({ command, args: [...args], timeoutMs: CHECK_TIMEOUT_MS });
    if (result.exitCode === 0) {
      return { ok: true };
    }
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`;
    return { ok: false, detail };
  }
}
