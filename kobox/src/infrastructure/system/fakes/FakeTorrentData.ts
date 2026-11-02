import type { TorrentDataPort } from '../../../domain/space/ports.js';
import type { Username } from '../../../domain/user/Username.js';

export interface RemovedData {
  readonly username: string;
  readonly path: string;
}

export class FakeTorrentData implements TorrentDataPort {
  readonly removed: RemovedData[] = [];
  private readonly refusing = new Set<string>();

  refusesToRemove(path: string): void {
    this.refusing.add(path);
  }

  remove(username: Username, path: string): Promise<void> {
    if (this.refusing.has(path)) {
      return Promise.reject(new Error(`rm: cannot remove ${path}: Permission denied`));
    }
    this.removed.push({ username: username.value, path });
    return Promise.resolve();
  }
}
