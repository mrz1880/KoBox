import { stat } from 'node:fs/promises';
import type { LocalPath } from '../../domain/sync/LocalPath.js';
import type { LocalFileFactsPort } from '../../domain/sync/ports.js';

// What a finished download actually left on disk. lstat rather than stat: a
// symlink a member planted must not let the pass follow it out of their home
// and copy somebody else's files to their machine.
export class FsLocalFileFacts implements LocalFileFactsPort {
  async isDirectory(path: LocalPath): Promise<boolean> {
    try {
      return (await stat(path.value)).isDirectory();
    } catch {
      return false;
    }
  }

  async exists(path: LocalPath): Promise<boolean> {
    try {
      // a symlink is NOT a file we are willing to carry across
      const found = await stat(path.value);
      return found.isDirectory() || found.isFile();
    } catch {
      return false;
    }
  }
}
