import { describe, expect, it } from 'vitest';
import { LoggableService } from '../../../../src/domain/maintenance/ManagedService.js';
import { AptUpdateAdapter } from '../../../../src/infrastructure/system/AptUpdateAdapter.js';
import { JournaldLogAdapter } from '../../../../src/infrastructure/system/JournaldLogAdapter.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  private readonly results = new Map<string, CommandResult>();

  onCommand(command: string, result: Partial<CommandResult>): void {
    this.results.set(command, { stdout: '', stderr: '', exitCode: 0, ...result });
  }

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve(
      this.results.get(request.command) ?? { stdout: '', stderr: '', exitCode: 0 },
    );
  }

  argvOf(command: string): readonly string[] | undefined {
    return this.calls.find((call) => call.command === command)?.args;
  }
}

describe('JournaldLogAdapter', () => {
  it('should_tail_one_unit_via_argv_only', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('journalctl', { stdout: 'line one\nline two\n' });

    const output = await new JournaldLogAdapter(runner).tail(
      LoggableService.parse('nginx'),
      200,
    );

    expect(output).toBe('line one\nline two\n');
    // no shell string: the unit name can never become a second argument
    expect(runner.argvOf('journalctl')).toEqual([
      '-u',
      'nginx',
      '-n',
      '200',
      '--no-pager',
      '--output=short-iso',
    ]);
  });
});

describe('AptUpdateAdapter', () => {
  it('should_count_only_the_lines_that_name_an_upgradable_package', async () => {
    const runner = new RecordingRunner();
    runner.onCommand('apt', {
      stdout: [
        'Listing...',
        'nginx/stable 1.22.1-9 amd64 [upgradable from: 1.22.1-8]',
        'openssl/stable 3.0.15-1 amd64 [upgradable from: 3.0.14-1]',
        '',
      ].join('\n'),
    });

    const result = await new AptUpdateAdapter(runner).listUpgradable();

    // the "Listing..." header is not a package, and counting it would report
    // an update that does not exist
    expect(result.count).toBe(2);
    expect(result.listing).not.toContain('Listing...');
  });

  it('should_refresh_the_index_before_reading_the_list', async () => {
    const runner = new RecordingRunner();

    await new AptUpdateAdapter(runner).listUpgradable();

    // reading a stale index would report yesterday's answer
    expect(runner.calls[0]?.command).toBe('apt-get');
    expect(runner.calls[0]?.args).toEqual(['update', '-qq']);
  });

  it('should_upgrade_without_asking_a_question_it_cannot_answer', async () => {
    const runner = new RecordingRunner();

    await new AptUpdateAdapter(runner).upgradeAll();

    const request = runner.calls.find((call) => call.args.includes('upgrade'));
    // an interactive conffile prompt would hang the worker until its timeout
    expect(request?.env).toEqual({ DEBIAN_FRONTEND: 'noninteractive' });
    expect(request?.args).toContain('-y');
    expect(request?.args).toContain('Dpkg::Options::=--force-confold');
  });
});
