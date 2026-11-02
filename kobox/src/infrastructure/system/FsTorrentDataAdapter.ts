import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { PathOutsideMemberSpaceError } from '../../domain/space/PathOutsideMemberSpaceError.js';
import type { TorrentDataPort } from '../../domain/space/ports.js';
import { WatchDir } from '../../domain/torrent/WatchDir.js';
import { homeOf } from '../../domain/user/homeDirectory.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// Every torrent of a member lands under the root watch directory's complete
// tree (labels are folders inside it): narrower than the whole home, so a
// path rTorrent reports elsewhere in the home is refused rather than erased.
function memberDownloads(username: Username): string {
  return WatchDir.root().completePath(homeOf(username));
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// Where a directory really is once every symbolic link on the way is followed.
// A part already gone is kept as written under its closest existing ancestor:
// nothing there can be a link, since nothing is there.
async function physicalDirectory(directory: string): Promise<string> {
  try {
    return await realpath(directory);
  } catch (error) {
    if (!isMissing(error) || directory === dirname(directory)) {
      throw error;
    }
    return join(await physicalDirectory(dirname(directory)), basename(directory));
  }
}

// Runs in the root worker, so it decides on where a path really leads, not on
// how it is spelled: `..` and a symlinked parent are resolved before checking.
// The last segment is never followed: a target that is itself a link is
// unlinked, and what it points to stays.
// The check alone leaves a window: a member could swap a parent folder for a
// link between the check and the removal. The removal therefore runs as the
// member, so the kernel refuses anything they could not delete themselves.
export class FsTorrentDataAdapter implements TorrentDataPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly downloadsOf: (username: Username) => string = memberDownloads,
  ) {}

  async remove(username: Username, path: string): Promise<void> {
    const downloads = await physicalDirectory(this.downloadsOf(username));
    const target = resolve(path);
    const physical = join(await physicalDirectory(dirname(target)), basename(target));
    if (!physical.startsWith(`${downloads}/`)) {
      throw new PathOutsideMemberSpaceError(path);
    }
    // -f: a path already gone is what the caller asked for; never crossing
    // into another mounted filesystem keeps a mount inside the tree out of it
    await runOrThrow(this.runner, {
      command: 'runuser',
      args: ['-u', username.value, '--', 'rm', '-rf', '--one-file-system', '--', physical],
    });
  }
}
