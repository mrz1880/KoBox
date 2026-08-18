import { describe, expect, it } from 'vitest';
import { ProcessSocketHealthProbe } from '../../../src/infrastructure/system/ProcessSocketHealthProbe.js';
import type { CommandRequest, CommandResult } from '../../../src/infrastructure/system/CommandRunner.js';

// Replays what pgrep really answers on a box running rtorrent: the binary
// renames its main thread to "rtorrent main", so the exact-name match that
// doctor used found nothing and reported unhealthy on every healthy box.
class PgrepLikeTheRealOne {
  readonly requests: CommandRequest[] = [];

  constructor(private readonly kind: 'rtorrent' | 'systemd') {}

  run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const byComm = request.args.includes('-x');
    // Two daemons, two opposite answers, both real:
    //   rtorrent  comm "rtorrent main", args "/usr/bin/rtorrent ..."
    //   systemd   comm "systemd",       args "/sbin/init"
    const found = this.kind === 'rtorrent' ? !byComm : byComm;
    return Promise.resolve(
      found
        ? { stdout: '1\n', stderr: '', exitCode: 0 }
        : { stdout: '', stderr: '', exitCode: 1 },
    );
  }
}

describe('the process health probe', () => {
  it('should_find_rtorrent_on_a_box_where_rtorrent_is_running', async () => {
    const probe = new ProcessSocketHealthProbe(new PgrepLikeTheRealOne('rtorrent'));

    const result = await probe.checkProcess('rtorrent');

    expect(result.state).toBe('healthy');
  });

  it('should_match_the_program_that_was_launched_not_the_thread_it_renamed_itself_to', async () => {
    const runner = new PgrepLikeTheRealOne('rtorrent');
    const probe = new ProcessSocketHealthProbe(runner);

    await probe.checkProcess('rtorrent');

    // the property that matters: the pattern is anchored at the start of the
    // command line, so a member's torrent named "rtorrent" in some argument
    // cannot make a dead daemon look alive
    const pattern = runner.requests.flatMap((r) => r.args).find((a) => a.startsWith('^'));
    expect(pattern).toContain('rtorrent');
    expect(new RegExp(pattern ?? '')).toEqual(expect.any(RegExp));
    expect(new RegExp(pattern ?? '').test('/usr/bin/rtorrent -n -o import=/home/a/.rtorrent.rc')).toBe(true);
    expect(new RegExp(pattern ?? '').test('/usr/bin/transmission --seed rtorrent.torrent')).toBe(false);
  });

  it('should_still_find_a_daemon_launched_under_another_name', async () => {
    // PID 1 has comm "systemd" and a command line of "/sbin/init". CI caught
    // this: matching only the command line would have called a live init dead.
    const probe = new ProcessSocketHealthProbe(new PgrepLikeTheRealOne('systemd'));

    const result = await probe.checkProcess('systemd');

    expect(result.state).toBe('healthy');
  });
});
