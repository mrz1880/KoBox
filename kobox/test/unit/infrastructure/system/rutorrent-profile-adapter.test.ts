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

  // test -f answers whether the ratio script is on this box
  constructor(private readonly scriptPresent = true) {}

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    const missing = request.command === 'test' && !this.scriptPresent;
    return Promise.resolve({ stdout: '', stderr: '', exitCode: missing ? 1 : 0 });
  }
}

describe('RutorrentProfileAdapter', () => {
  it('should_give_a_member_their_profile_folder_and_close_what_ruTorrent_left_open', async () => {
    const runner = new RecordingRunner();

    await new RutorrentProfileAdapter(runner).ensureProfile(Username.parse('alice'));

    const dir = '/var/lib/rutorrent/users/alice';
    expect(runner.calls.map((call) => [call.command, ...call.args])).toEqual([
      // theirs and the web server's; setgid so what ruTorrent adds stays in their group.
      // ruTorrent makes settings, torrents and tmp only when it creates the
      // profile itself: a folder made ahead of it left a new member without
      // torrents, and ruTorrent refused to add any
      ['install', '-d', '-o', 'www-data', '-g', 'alice', '-m', '2770', dir, `${dir}/settings`, `${dir}/torrents`, `${dir}/tmp`],
      // what ruTorrent already created (0777, www-data's group) joins them
      ['chown', '-R', 'www-data:alice', dir],
      ['chmod', '-R', 'g+rwX,o-rwx', dir],
      ['find', dir, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'],
    ]);
  });

  it('should_let_a_member_s_own_rutorrent_into_the_folder_holding_their_config', async () => {
    const runner = new RecordingRunner();

    await new RutorrentProfileAdapter(runner).ensureConfigFolder(Username.parse('alice'));

    // ruTorrent runs as the member: a folder left root:www-data from before
    // hid their SCGI port, and ruTorrent lost their rTorrent
    const dir = '/var/www/rutorrent/conf/users/alice';
    expect(runner.calls.map((call) => [call.command, ...call.args])).toEqual([
      ['chown', 'root:alice', dir],
      ['chmod', '0750', dir],
    ]);
  });

  it('should_offer_the_ratio_groups_as_the_member_like_the_rest_of_their_rutorrent', async () => {
    const runner = new RecordingRunner();

    await new RutorrentProfileAdapter(runner).offerRatioGroups(Username.parse('alice'));

    // ruTorrent finds a member's settings by REMOTE_USER, and now runs as the
    // member: the script writes them the same way
    expect(runner.calls.map((call) => [call.command, ...call.args])).toEqual([
      ['test', '-f', '/usr/local/share/kobox/rutorrent-ratios.php'],
      ['runuser', '-u', 'alice', '--', 'env', 'REMOTE_USER=alice', 'php', '/usr/local/share/kobox/rutorrent-ratios.php'],
    ]);
  });

  // ruTorrent not installed (unpinned): nothing to offer, and no reason to
  // fail the preparation of a member
  it('should_offer_nothing_where_ruTorrent_is_not_installed', async () => {
    const runner = new RecordingRunner(false);

    await new RutorrentProfileAdapter(runner).offerRatioGroups(Username.parse('alice'));

    expect(runner.calls.map((call) => call.command)).toEqual(['test']);
  });
});
