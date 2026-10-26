import { describe, expect, it } from 'vitest';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { MvTorrentFiling } from '../../../../src/infrastructure/system/MvTorrentFiling.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }
}

describe('MvTorrentFiling', () => {
  it('should_move_the_file_without_ever_overwriting_one_already_filed', async () => {
    const runner = new RecordingRunner();

    await new MvTorrentFiling(runner).file(
      '/home/alice/rtorrent/watch/films/-x.torrent',
      '/home/alice/rtorrent/torrents/films',
    );

    // `--` so a file named like an option stays a file name
    expect(runner.calls.map((call) => [call.command, ...call.args])).toEqual([
      ['mv', '-n', '--', '/home/alice/rtorrent/watch/films/-x.torrent', '/home/alice/rtorrent/torrents/films/'],
    ]);
  });
});
