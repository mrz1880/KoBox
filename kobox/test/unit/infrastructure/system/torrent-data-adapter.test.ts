import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Username } from '../../../../src/domain/user/Username.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { FsTorrentDataAdapter } from '../../../../src/infrastructure/system/FsTorrentDataAdapter.js';

class RecordingRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }
}

let sandbox: string;
let downloads: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kobox-torrent-data-'));
  downloads = join(sandbox, 'rtorrent', 'complete');
  mkdirSync(downloads, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('FsTorrentDataAdapter', () => {
  it('should_erase_as_the_member_so_a_swapped_folder_cannot_reach_what_they_could_not_delete', async () => {
    // The root worker checks the path, then a member could swap a parent for
    // a link before the removal runs: erasing as the member leaves the kernel
    // to refuse anything they do not own.
    const file = join(downloads, 'debian-13.iso');
    writeFileSync(file, 'iso');
    const runner = new RecordingRunner();
    const adapter = new FsTorrentDataAdapter(runner, () => downloads);

    await adapter.remove(Username.parse('alice'), file);

    expect(runner.requests.map((request) => [request.command, ...request.args])).toEqual([
      [
        'runuser',
        '-u',
        'alice',
        '--',
        'rm',
        '-rf',
        '--one-file-system',
        '--',
        join(realpathSync(downloads), 'debian-13.iso'),
      ],
    ]);
  });
});
