import { WEB_SERVER_USER } from '../../domain/installation/platform.js';
import { rutorrentProfilesDir } from '../../domain/installation/rendering.js';
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
}
