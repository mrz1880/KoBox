import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Label } from '../../domain/torrent/Label.js';
import type { DownloadPlacementPort } from '../../domain/ddl/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const DEFAULT_HOME_BASE = '/home';

// The root worker's placement step: move the staged file into the user's home
// completed-downloads layout (same as torrents, so the *arr folder-import picks
// it up over NFS) and chown it to the user. Copy+unlink because staging
// (/var/lib/kobox) and the home may live on different mounts.
export class DdlPlacementAdapter implements DownloadPlacementPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly homeBase: string = DEFAULT_HOME_BASE,
  ) {}

  async place(
    stagedPath: string,
    username: Username,
    category: Label,
  ): Promise<string> {
    const targetDir = join(this.homeBase, username.value, 'rtorrent', 'complete', category.value);
    await mkdir(targetDir, { recursive: true });
    const targetPath = join(targetDir, basename(stagedPath));
    await copyFile(stagedPath, targetPath);
    await rm(stagedPath, { force: true });
    await runOrThrow(this.runner, {
      command: 'chown',
      args: ['-R', `${username.value}:${username.value}`, targetDir],
    });
    return targetPath;
  }
}
