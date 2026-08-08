import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { MediaPath } from '../../domain/media/MediaFile.js';
import type { MediaEntry, MediaScanPort } from '../../domain/media/ports.js';
import type { Username } from '../../domain/user/Username.js';

const DEFAULT_HOME_BASE = '/home';
// deep enough for complete/<category>/<release>/<file>, shallow enough that a
// symlink loop or a pathological tree cannot spin the worker
const MAX_DEPTH = 4;

// Walks ~user/rtorrent/complete. Symlinks are not followed: a user could
// otherwise point one at /etc and have the portal list it.
export class FsMediaScanner implements MediaScanPort {
  constructor(private readonly homeBase: string = DEFAULT_HOME_BASE) {}

  async scan(username: Username): Promise<readonly MediaEntry[]> {
    const root = join(this.homeBase, username.value, 'rtorrent', 'complete');
    const found: MediaEntry[] = [];
    await this.walk(root, root, 0, found);
    return found;
  }

  private async walk(
    root: string,
    dir: string,
    depth: number,
    found: MediaEntry[],
  ): Promise<void> {
    if (depth > MAX_DEPTH) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return; // absent or unreadable: nothing to list, not an error
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(root, full, depth + 1, found);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        const info = await stat(full);
        found.push({ path: MediaPath.parse(relative(root, full)), sizeBytes: info.size });
      } catch {
        continue; // vanished between readdir and stat
      }
    }
  }
}
