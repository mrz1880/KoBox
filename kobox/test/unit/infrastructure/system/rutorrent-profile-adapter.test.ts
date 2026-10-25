import { describe, expect, it } from 'vitest';
import { Username } from '../../../../src/domain/user/Username.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { RutorrentProfileAdapter } from '../../../../src/infrastructure/system/RutorrentProfileAdapter.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }
}

describe('RutorrentProfileAdapter', () => {
  it('should_give_a_member_their_profile_folder_and_close_what_ruTorrent_left_open', async () => {
    const runner = new RecordingRunner();

    await new RutorrentProfileAdapter(runner).ensureProfile(Username.parse('alice'));

    const dir = '/var/lib/rutorrent/users/alice';
    expect(runner.calls.map((call) => [call.command, ...call.args])).toEqual([
      // theirs and the web server's; setgid so what ruTorrent adds stays in their group
      ['install', '-d', '-o', 'www-data', '-g', 'alice', '-m', '2770', dir],
      // what ruTorrent already created (0777, www-data's group) joins them
      ['chown', '-R', 'www-data:alice', dir],
      ['chmod', '-R', 'g+rwX,o-rwx', dir],
      ['find', dir, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'],
    ]);
  });
});
