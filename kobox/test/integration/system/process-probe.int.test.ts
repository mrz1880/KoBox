import { describe, expect, it } from 'vitest';
import { ProcessSocketHealthProbe } from '../../../src/infrastructure/system/ProcessSocketHealthProbe.js';
import type { CommandRequest, CommandResult } from '../../../src/infrastructure/system/CommandRunner.js';

// Replays what pgrep really answers on a box running rtorrent: the binary
// renames its main thread to "rtorrent main", so the exact-name match that
// doctor used found nothing and reported unhealthy on every healthy box.
class PgrepLikeTheRealOne {
  readonly requests: CommandRequest[] = [];

  run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const exact = request.args.includes('-x');
    // -x compares against comm, which is "rtorrent main", never "rtorrent"
    return Promise.resolve(
      exact
        ? { stdout: '', stderr: '', exitCode: 1 }
        : { stdout: '11323\n670741\n', stderr: '', exitCode: 0 },
    );
  }
}

describe('the process health probe', () => {
  it('should_find_rtorrent_on_a_box_where_rtorrent_is_running', async () => {
    const probe = new ProcessSocketHealthProbe(new PgrepLikeTheRealOne());

    const result = await probe.checkProcess('rtorrent');

    expect(result.state).toBe('healthy');
  });

  it('should_match_the_program_that_was_launched_not_the_thread_it_renamed_itself_to', async () => {
    const runner = new PgrepLikeTheRealOne();
    const probe = new ProcessSocketHealthProbe(runner);

    await probe.checkProcess('rtorrent');

    // the property that matters: the pattern is anchored at the start of the
    // command line, so a member's torrent named "rtorrent" in some argument
    // cannot make a dead daemon look alive
    const pattern = runner.requests[0]?.args.find((a) => a.startsWith('^'));
    expect(pattern).toContain('rtorrent');
    expect(new RegExp(pattern ?? '')).toEqual(expect.any(RegExp));
    expect(new RegExp(pattern ?? '').test('/usr/bin/rtorrent -n -o import=/home/a/.rtorrent.rc')).toBe(true);
    expect(new RegExp(pattern ?? '').test('/usr/bin/transmission --seed rtorrent.torrent')).toBe(false);
  });
});
