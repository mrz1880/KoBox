import type { WatchDirPort } from '../../domain/torrent/ports.js';
import type { WatchDir } from '../../domain/torrent/WatchDir.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';
import { KOBOX_USERS_GROUP } from './SystemAccountAdapter.js';

export class WatchDirAdapter implements WatchDirPort {
  constructor(private readonly runner: CommandRunner) {}

  async ensureLayout(username: Username, watchDirs: readonly WatchDir[]): Promise<void> {
    const home = `/home/${username.value}`;
    await this.install(username, '0755', `${home}/rtorrent`);
    await this.install(username, '0755', `${home}/rtorrent/config.d`);
    for (const dir of watchDirs) {
      // watch is 0775: ruTorrent (web) drops uploaded .torrent files there
      await this.install(username, '0775', dir.watchPath(home));
      await this.install(username, '0755', dir.completePath(home));
      await this.install(username, '0755', dir.torrentsPath(home));
    }
  }

  private async install(username: Username, mode: string, path: string): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'install',
      args: ['-d', '-o', username.value, '-g', KOBOX_USERS_GROUP, '-m', mode, path],
    });
  }
}
