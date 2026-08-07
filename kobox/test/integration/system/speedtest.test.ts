import { describe, expect, it } from 'vitest';
import {
  LibrespeedAdapter,
  SpeedtestUnavailableError,
} from '../../../src/infrastructure/system/LibrespeedAdapter.js';
import type { CommandRequest, CommandResult, CommandRunner } from '../../../src/infrastructure/system/CommandRunner.js';

const NOW = '2026-07-31 10:00:00';

// the shape librespeed-cli --json actually emits
const REAL_OUTPUT = JSON.stringify([
  {
    timestamp: '2026-07-31T10:00:00Z',
    server: { name: 'Test Server, Paris', url: 'https://example.net' },
    client: { ip: '203.0.113.7' },
    bytes_sent: 1234,
    bytes_received: 5678,
    ping: 11.4,
    jitter: 0.8,
    upload: 92.35,
    download: 913.72,
  },
]);

class ScriptedRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  constructor(private readonly result: CommandResult | Error) {}
  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

function ok(stdout: string): CommandResult {
  return { stdout, stderr: '', exitCode: 0 };
}

describe('LibrespeedAdapter', () => {
  it('should_turn_a_real_measurement_into_domain_rates', async () => {
    const runner = new ScriptedRunner(ok(REAL_OUTPUT));

    const result = await new LibrespeedAdapter(runner, '/usr/local/bin/librespeed-cli').measure(NOW);

    // librespeed reports Mbit/s; Bandwidth counts bits per second
    expect(result.download.bps).toBe(913_720_000);
    expect(result.upload.bps).toBe(92_350_000);
    expect(result.latencyMs).toBe(11);
    expect(result.server).toBe('Test Server, Paris');
    expect(result.measuredAt).toBe(NOW);
  });

  it('should_ask_for_json_and_a_bounded_run', async () => {
    const runner = new ScriptedRunner(ok(REAL_OUTPUT));

    await new LibrespeedAdapter(runner).measure(NOW);

    // the run must be bounded: a hanging measurement would hold the worker
    expect(runner.calls[0]?.args).toContain('--json');
    expect(runner.calls[0]?.timeoutMs).toBeGreaterThan(0);
  });

  it('should_say_what_to_do_when_the_binary_is_not_installed', async () => {
    const runner = new ScriptedRunner(new Error('spawn ENOENT'));

    await expect(new LibrespeedAdapter(runner).measure(NOW)).rejects.toThrow(
      /is not installed — pin the speedtest component/,
    );
  });

  it('should_refuse_an_empty_result_rather_than_invent_a_rate', async () => {
    const runner = new ScriptedRunner(ok('[]'));

    await expect(new LibrespeedAdapter(runner).measure(NOW)).rejects.toThrow(
      SpeedtestUnavailableError,
    );
  });
});
