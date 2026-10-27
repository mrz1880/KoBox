import { PHP_FPM, WEB_SERVER_USER } from '../../domain/installation/platform.js';
import type { WatchDirPort } from '../../domain/torrent/ports.js';
import type { WatchDir } from '../../domain/torrent/WatchDir.js';
import type { Username } from '../../domain/user/Username.js';
import { homeOf } from '../../domain/user/homeDirectory.js';
import { runAllowing, runOrThrow, type CommandRunner } from './CommandRunner.js';

// systemctl's exit status for a unit that does not exist
const UNIT_NOT_FOUND = 5;
// find's exit status when its starting directory does not exist
const FIND_MISSING_START_POINT = 1;

// A member's tree belongs to the member's own group, never to a group every
// member shares: that one let any member write into another's watch folder
// and list their downloads. The web server joins each member's group instead,
// which is what lets nginx stream a finished file, ruTorrent and Nextcloud
// drop a .torrent into watch, and nobody else in.
export class WatchDirAdapter implements WatchDirPort {
  constructor(private readonly runner: CommandRunner) {}

  async ensureLayout(username: Username, watchDirs: readonly WatchDir[]): Promise<void> {
    await this.letTheWebServerIn(username);
    const home = homeOf(username);
    await this.install(username, '0750', `${home}/rtorrent`);
    // read by rtorrent alone: the web server, in the member's group for
    // Nextcloud and the media player, has no business in the config or logs
    await this.install(username, '0700', `${home}/rtorrent/config.d`);
    await this.install(username, '0700', `${home}/logs`);
    for (const dir of watchDirs) {
      // setgid: a .torrent the web server drops keeps the member's group
      await this.install(username, '2770', dir.watchPath(home));
      await this.install(username, '0750', dir.completePath(home));
      await this.install(username, '0750', dir.torrentsPath(home));
    }
  }

  async removeIfEmpty(username: Username, dir: WatchDir): Promise<boolean> {
    const home = homeOf(username);
    const paths = [dir.watchPath(home), dir.completePath(home), dir.torrentsPath(home)];
    const present: string[] = [];
    for (const path of paths) {
      // a tree that is already gone holds nothing
      const found = await runAllowing(
        this.runner,
        { command: 'find', args: [path, '-mindepth', '1', '-print', '-quit'] },
        [FIND_MISSING_START_POINT],
      );
      if (found.stdout.trim() !== '') {
        return false;
      }
      if (found.exitCode === 0) {
        present.push(path);
      }
    }
    // rmdir and not rm -r: something written in between makes it fail rather
    // than vanish
    for (const path of present) {
      await runOrThrow(this.runner, { command: 'rmdir', args: [path] });
    }
    return true;
  }

  private async letTheWebServerIn(username: Username): Promise<void> {
    const groups = await runOrThrow(this.runner, { command: 'id', args: ['-nG', WEB_SERVER_USER] });
    if (groups.stdout.trim().split(/\s+/).includes(username.value)) {
      return;
    }
    await runOrThrow(this.runner, {
      command: 'usermod',
      args: ['-aG', username.value, WEB_SERVER_USER],
    });
    // a running process keeps the groups it started with: new workers pick
    // the membership up, the old ones finish their requests and go. A unit
    // that is stopped or not installed at all has nothing to reload.
    for (const unit of ['nginx', PHP_FPM.unit]) {
      await runAllowing(
        this.runner,
        { command: 'systemctl', args: ['try-reload-or-restart', unit] },
        [UNIT_NOT_FOUND],
      );
    }
  }

  private async install(username: Username, mode: string, path: string): Promise<void> {
    await runOrThrow(this.runner, {
      command: 'install',
      args: ['-d', '-o', username.value, '-g', username.value, '-m', mode, path],
    });
  }
}
