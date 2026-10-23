import { describe, expect, it } from 'vitest';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { OccNextcloudAdapter } from '../../../../src/infrastructure/system/OccNextcloudAdapter.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }

  occArgs(): string[] {
    // runuser -u www-data -- php <occ> ...: keep what follows the occ path
    return this.calls.map((call) => call.args.slice(5).join(' '));
  }
}

describe('OccNextcloudAdapter', () => {
  it('should_trust_the_public_name_and_answer_under_nextcloud_over_https', async () => {
    const runner = new RecordingRunner();

    await new OccNextcloudAdapter(runner).serveAt({ host: 'box.example.org', port: 8189 });

    expect(runner.calls.every((call) => call.command === 'runuser')).toBe(true);
    expect(runner.occArgs()).toEqual([
      'config:system:set trusted_domains 0 --value=localhost',
      'config:system:set trusted_domains 1 --value=box.example.org',
      'config:system:set overwritewebroot --value=/nextcloud',
      'config:system:set overwriteprotocol --value=https',
      'config:system:set overwrite.cli.url --value=https://box.example.org:8189/nextcloud',
    ]);
  });
});
