import { DomainError } from '../shared/DomainError.js';
import type { Label } from './Label.js';
import { SyncMode } from './SyncMode.js';

export class RootWatchDirCannotSyncError extends DomainError {
  constructor() {
    super('the unlabelled watch directory cannot be synchronised');
  }
}

// One watch directory of an rtorrent instance: the unlabeled root, or a
// labeled one whose watch/complete/torrents trees are scoped under the label.
export class WatchDir {
  private constructor(
    readonly label?: Label,
    // A new category sends nothing until its owner says otherwise: turning sync
    // on is a decision about somebody else's machine.
    readonly syncMode: SyncMode = SyncMode.off,
  ) {}

  static root(): WatchDir {
    return new WatchDir();
  }

  static labeled(label: Label, syncMode: SyncMode = SyncMode.off): WatchDir {
    return new WatchDir(label, syncMode);
  }

  // Returns a copy: watch dirs are values, and two categories differing only by
  // mode must never share one object.
  withSyncMode(syncMode: SyncMode): WatchDir {
    if (this.label === undefined) {
      // the root holds everything that carries no label; pushing it would push
      // the whole library on every finish
      throw new RootWatchDirCannotSyncError();
    }
    return new WatchDir(this.label, syncMode);
  }

  watchPath(home: string): string {
    return this.underHome(home, this.watchTree());
  }

  completePath(home: string): string {
    return this.underHome(home, this.completeTree());
  }

  torrentsPath(home: string): string {
    return this.underHome(home, this.torrentsTree());
  }

  // The same trees relative to the member's home, for what names them from
  // there: a Nextcloud mount, a path a member types.
  watchTree(): string {
    return this.scoped('watch');
  }

  completeTree(): string {
    return this.scoped('complete');
  }

  torrentsTree(): string {
    return this.scoped('torrents');
  }

  equals(other: WatchDir): boolean {
    return (this.label?.value ?? '') === (other.label?.value ?? '');
  }

  private underHome(home: string, tree: string): string {
    return `${home.replace(/\/$/, '')}/${tree}`;
  }

  private scoped(tree: string): string {
    const base = `rtorrent/${tree}`;
    return this.label ? `${base}/${this.label.value}` : base;
  }
}
