import { describe, expect, it } from 'vitest';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { UpgradeHostAdapter } from '../../../../src/infrastructure/system/UpgradeHostAdapter.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }
}

describe('UpgradeHostAdapter', () => {
  it('should_build_a_staged_release_from_inside_its_tree', async () => {
    // corepack resolves the pnpm version from the working directory: run from
    // elsewhere with --dir, it fetched the latest pnpm, which refused the
    // release's pinned packageManager and failed the first production upgrade
    const runner = new RecordingRunner();
    const release = '/opt/kobox/releases/abc123/kobox';

    await new UpgradeHostAdapter(runner).buildRelease(release);

    expect(runner.calls.map((call) => [call.command, call.cwd, call.args])).toEqual([
      ['pnpm', release, ['install', '--frozen-lockfile', '--prod=false']],
      ['pnpm', release, ['build']],
    ]);
  });
});
