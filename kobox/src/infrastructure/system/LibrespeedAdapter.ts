import { librespeedResultSchema } from '../../application/maintenance/speedtestSchemas.js';
import type { SpeedtestPort } from '../../application/maintenance/SpeedtestPort.js';
import { Speedtest } from '../../domain/maintenance/speedtest.js';
import { Bandwidth } from '../../domain/security/Bandwidth.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

export const DEFAULT_LIBRESPEED_BIN = '/usr/local/lib/kobox-speedtest/librespeed-cli';

export class SpeedtestUnavailableError extends Error {
  constructor(detail: string) {
    super(`speedtest unavailable: ${detail}`);
    this.name = 'SpeedtestUnavailableError';
  }
}

// Measures the link with librespeed-cli. It saturates the connection for its
// duration by design, which is why nothing schedules it — see RunSpeedtest.
export class LibrespeedAdapter implements SpeedtestPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly binary: string = DEFAULT_LIBRESPEED_BIN,
    private readonly timeoutMs = 180_000,
  ) {}

  async measure(now: string): Promise<Speedtest> {
    let stdout: string;
    try {
      const result = await runOrThrow(this.runner, {
        command: this.binary,
        args: ['--json', '--duration', '10'],
        timeoutMs: this.timeoutMs,
      });
      stdout = result.stdout;
    } catch (error) {
      // the binary is absent (component not pinned) or the run failed; either
      // way the operator needs one actionable line, not a spawn stack
      throw new SpeedtestUnavailableError(
        error instanceof Error && error.message.includes('ENOENT')
          ? `${this.binary} is not installed — pin the speedtest component and re-run kobox install`
          : 'the measurement did not complete',
      );
    }
    const [measurement] = librespeedResultSchema.parse(JSON.parse(stdout));
    if (measurement === undefined) {
      throw new SpeedtestUnavailableError('the measurement returned no result');
    }
    return Speedtest.record({
      // librespeed reports Mbit/s; Bandwidth is an integer bit/s count
      download: Bandwidth.bitsPerSecond(Math.max(1, Math.round(measurement.download * 1_000_000))),
      upload: Bandwidth.bitsPerSecond(Math.max(1, Math.round(measurement.upload * 1_000_000))),
      latencyMs: Math.round(measurement.ping),
      server: measurement.server.name,
      measuredAt: now,
    });
  }
}
