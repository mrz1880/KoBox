import type { WatchDirPort } from '../../../domain/torrent/ports.js';
import type { WatchDir } from '../../../domain/torrent/WatchDir.js';
import type { Username } from '../../../domain/user/Username.js';

export class FakeWatchDirs implements WatchDirPort {
  private readonly layouts = new Map<string, readonly WatchDir[]>();

  ensureLayout(username: Username, watchDirs: readonly WatchDir[]): Promise<void> {
    this.layouts.set(username.value, watchDirs);
    return Promise.resolve();
  }

  // folders a test says hold a download: "<username>/<label>"
  readonly occupied = new Set<string>();

  removeIfEmpty(username: Username, dir: WatchDir): Promise<boolean> {
    return Promise.resolve(!this.occupied.has(`${username.value}/${dir.label?.value ?? ''}`));
  }

  layoutFor(username: Username): readonly WatchDir[] {
    return this.layouts.get(username.value) ?? [];
  }
}
