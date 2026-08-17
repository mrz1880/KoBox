import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Label } from '../../../src/domain/torrent/Label.js';
import { Username } from '../../../src/domain/user/Username.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../src/infrastructure/system/CommandRunner.js';
import { DdlPlacementAdapter } from '../../../src/infrastructure/system/DdlPlacementAdapter.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }

  argvs(): readonly (readonly string[])[] {
    return this.calls.map((c) => [c.command, ...c.args]);
  }
}

let dir: string;
let homeBase: string;
let staging: string;
let runner: RecordingRunner;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-place-'));
  homeBase = join(dir, 'home');
  staging = join(dir, 'staging');
  runner = new RecordingRunner();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('DdlPlacementAdapter', () => {
  it('should_move_the_file_into_the_user_complete_dir_and_chown_it', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(staging, { recursive: true });
    const stagedPath = join(staging, 'Movie.2026.mkv');
    writeFileSync(stagedPath, 'CONTENT');
    const adapter = new DdlPlacementAdapter(runner, homeBase);

    const finalPath = await adapter.place(stagedPath, Username.parse('alice'), Label.parse('films'));

    expect(finalPath).toBe(join(homeBase, 'alice', 'rtorrent', 'complete', 'films', 'Movie.2026.mkv'));
    expect(existsSync(finalPath)).toBe(true);
    expect(readFileSync(finalPath, 'utf8')).toBe('CONTENT');
    // the staged copy is gone (moved, not left behind)
    expect(existsSync(stagedPath)).toBe(false);
    // ownership handed to the user (chown -R over the category dir)
    expect(runner.argvs()).toContainEqual([
      'chown',
      '-R',
      'alice:alice',
      join(homeBase, 'alice', 'rtorrent', 'complete', 'films'),
    ]);
  });
});
