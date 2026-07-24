import type { Label } from './Label.js';

// One watch directory of an rtorrent instance: the unlabeled root, or a
// labeled one whose watch/complete/torrents trees are scoped under the label.
export class WatchDir {
  private constructor(readonly label?: Label) {}

  static root(): WatchDir {
    return new WatchDir();
  }

  static labeled(label: Label): WatchDir {
    return new WatchDir(label);
  }

  watchPath(home: string): string {
    return this.scoped(home, 'watch');
  }

  completePath(home: string): string {
    return this.scoped(home, 'complete');
  }

  torrentsPath(home: string): string {
    return this.scoped(home, 'torrents');
  }

  equals(other: WatchDir): boolean {
    return (this.label?.value ?? '') === (other.label?.value ?? '');
  }

  private scoped(home: string, tree: string): string {
    const base = `${home.replace(/\/$/, '')}/rtorrent/${tree}`;
    return this.label ? `${base}/${this.label.value}` : base;
  }
}
