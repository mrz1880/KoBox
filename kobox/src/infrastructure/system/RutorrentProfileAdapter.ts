import { WEB_SERVER_USER } from '../../domain/installation/platform.js';
import {
  renderRutorrentRatioOffer,
  rutorrentProfilesDir,
  rutorrentUserConfigDir,
} from '../../domain/installation/rendering.js';
import type { RutorrentProfilePort } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// A member's ruTorrent profile folder belongs to the web server (php-fpm writes
// their settings) and to the member's own group (their rTorrent leaves the
// answers to ruTorrent's external checks there). Nobody else gets in: before
// this, ruTorrent's default mask left these folders 0777.
const PROFILE_SUBFOLDERS = ['settings', 'torrents', 'tmp'] as const;

export class RutorrentProfileAdapter implements RutorrentProfilePort {
  constructor(private readonly runner: CommandRunner) {}

  async ensureProfile(username: Username): Promise<void> {
    const dir = `${rutorrentProfilesDir()}/${username.value}`;
    const group = username.value;
    const steps: readonly (readonly [string, ...string[]])[] = [
      // ruTorrent makes these three only when it creates the profile folder
      // itself, so a folder made ahead of it must come with them
      ['install', '-d', '-o', WEB_SERVER_USER, '-g', group, '-m', '2770', dir,
        ...PROFILE_SUBFOLDERS.map((sub) => `${dir}/${sub}`)],
      ['chown', '-R', `${WEB_SERVER_USER}:${group}`, dir],
      ['chmod', '-R', 'g+rwX,o-rwx', dir],
      ['find', dir, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'],
    ];
    for (const [command, ...args] of steps) {
      await runOrThrow(this.runner, { command, args });
    }
  }

  // ruTorrent runs as the member, who must reach their config.php. Set on every
  // run, not only at creation: folders made before ruTorrent ran as the member
  // were root:www-data and hid the member's SCGI port from their own ruTorrent.
  async ensureConfigFolder(username: Username): Promise<void> {
    const dir = rutorrentUserConfigDir(username.value);
    await runOrThrow(this.runner, { command: 'chown', args: [`root:${username.value}`, dir] });
    await runOrThrow(this.runner, { command: 'chmod', args: ['0750', dir] });
  }

  // ruTorrent finds a member's settings by REMOTE_USER and runs as the member,
  // who reaches the folder through its group: the script does the same
  async offerRatioGroups(username: Username): Promise<void> {
    const script = renderRutorrentRatioOffer().path;
    // laid down with ruTorrent: no ruTorrent on this box, nothing to offer
    if ((await this.runner.run({ command: 'test', args: ['-f', script] })).exitCode !== 0) {
      return;
    }
    await runOrThrow(this.runner, {
      command: 'runuser',
      args: ['-u', username.value, '--', 'env', `REMOTE_USER=${username.value}`, 'php', script],
    });
  }
}
