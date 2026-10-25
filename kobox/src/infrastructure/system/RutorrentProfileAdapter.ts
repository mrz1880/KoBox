import { WEB_SERVER_USER } from '../../domain/installation/platform.js';
import {
  renderRutorrentRatioOffer,
  rutorrentProfilesDir,
} from '../../domain/installation/rendering.js';
import type { RutorrentProfilePort } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// A member's ruTorrent profile folder belongs to the web server (php-fpm writes
// their settings) and to the member's own group (their rTorrent leaves the
// answers to ruTorrent's external checks there). Nobody else gets in: before
// this, ruTorrent's default mask left these folders 0777.
export class RutorrentProfileAdapter implements RutorrentProfilePort {
  constructor(private readonly runner: CommandRunner) {}

  async ensureProfile(username: Username): Promise<void> {
    const dir = `${rutorrentProfilesDir()}/${username.value}`;
    const group = username.value;
    const steps: readonly (readonly [string, ...string[]])[] = [
      ['install', '-d', '-o', WEB_SERVER_USER, '-g', group, '-m', '2770', dir],
      ['chown', '-R', `${WEB_SERVER_USER}:${group}`, dir],
      ['chmod', '-R', 'g+rwX,o-rwx', dir],
      ['find', dir, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'],
    ];
    for (const [command, ...args] of steps) {
      await runOrThrow(this.runner, { command, args });
    }
  }

  // ruTorrent finds a member's settings by REMOTE_USER, and the web server owns
  // the folder they live in: the script runs as it, for that member only
  async offerRatioGroups(username: Username): Promise<void> {
    const script = renderRutorrentRatioOffer().path;
    // laid down with ruTorrent: no ruTorrent on this box, nothing to offer
    if ((await this.runner.run({ command: 'test', args: ['-f', script] })).exitCode !== 0) {
      return;
    }
    await runOrThrow(this.runner, {
      command: 'runuser',
      args: ['-u', WEB_SERVER_USER, '--', 'env', `REMOTE_USER=${username.value}`, 'php', script],
    });
  }
}
