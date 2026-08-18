import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RtorrentConfigAdapter } from '../../../src/infrastructure/system/RtorrentConfigAdapter.js';
import type { CommandRequest, CommandResult } from '../../../src/infrastructure/system/CommandRunner.js';

// chown needs root and a real account, neither of which a unit test has. What
// matters here is the mode of the directory the adapter creates, so the runner
// records the chown it would have run and the filesystem answers for the rest.
class RecordingRunner {
  readonly requests: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }
}

describe('a directory created for a member-owned file', () => {
  it('should_be_one_the_member_can_actually_enter', async () => {
    // rtorrent reads its own blocklist as the member. A directory created
    // root:root 0770 left every instance crash-looping on "could not open ip
    // filter file" the first time it restarted after a blocklist run, while
    // the file itself was perfectly readable.
    const root = mkdtempSync(join(tmpdir(), 'kobox-dirs-'));
    const runner = new RecordingRunner();
    const adapter = new RtorrentConfigAdapter(runner);

    await adapter.apply([
      {
        path: join(root, 'home', 'alice', 'blocklist', 'blocklist_rtorrent.txt'),
        content: '1.0.0.0-1.0.0.255\n',
        mode: '0640',
        owner: 'root',
        group: 'alice',
      },
    ]);

    const dir = statSync(join(root, 'home', 'alice', 'blocklist'));
    // group execute is the bit that decides whether the member can traverse
    expect(dir.mode & 0o050).toBe(0o050);
    expect(
      runner.requests.some(
        (r) => r.command === 'chown' && r.args.includes(`root:alice`) &&
          r.args.some((a) => a.endsWith('blocklist')),
      ),
    ).toBe(true);
  });

  it('should_leave_a_root_only_file_alone', async () => {
    // /etc/kobox holds secrets; widening it because a file was written there
    // would be the opposite of the fix
    const root = mkdtempSync(join(tmpdir(), 'kobox-dirs-'));
    const runner = new RecordingRunner();
    const adapter = new RtorrentConfigAdapter(runner);

    await adapter.apply([
      {
        path: join(root, 'etc', 'kobox', 'worker.env'),
        content: 'KOBOX_DB=x\n',
        mode: '0600',
        owner: 'root',
        group: 'root',
      },
    ]);

    // the assertion is about what the adapter does, not about the umask the
    // machine happened to have: it must not touch a root-group directory at all
    expect(runner.requests.filter((r) => r.args.some((a) => a.endsWith('kobox')))).toEqual([]);
  });
});
