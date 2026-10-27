import { DomainError } from '../shared/DomainError.js';
import type { RtorrentPort, ScgiPort } from '../user/Port.js';
import type { Username } from '../user/Username.js';
import { RecyclingMode } from './RecyclingMode.js';
import type { Label } from './Label.js';
import { WatchDir } from './WatchDir.js';
import type { SyncMode } from './SyncMode.js';
import type { RtorrentInstanceProvisioned, WatchDirAdded } from './events.js';

export class UnknownCategoryError extends DomainError {
  constructor(label: string) {
    super(`no category ${JSON.stringify(label)} on this instance`);
  }
}

export class FolderNameTakenError extends DomainError {
  constructor(label: string) {
    super(`there is already a folder named ${JSON.stringify(label)}`);
  }
}

export type TorrentPrivacy = 'private' | 'public';
export type AdmissionDecision = 'accepted' | 'rejected-public-tracker';

interface TorrentInstanceProps {
  readonly username: Username;
  readonly scgiPort: ScgiPort;
  readonly rtorrentPort: RtorrentPort;
  readonly watchDirs: readonly WatchDir[];
  readonly allowPublicTracker: boolean;
  readonly recycling: RecyclingMode;
  readonly syncDisabled: boolean;
}

// One rtorrent instance per seedbox user. Identity is the username (natural
// key: at most one instance per user). Behavior flags are DB-backed state
// read at event time — never baked into rendered files (the persistent-hooks
// ADR from the prod inspection).
export class TorrentInstance {
  readonly username: Username;
  readonly scgiPort: ScgiPort;
  readonly rtorrentPort: RtorrentPort;
  readonly watchDirs: readonly WatchDir[];
  readonly allowPublicTracker: boolean;
  readonly recycling: RecyclingMode;
  readonly syncDisabled: boolean;

  private constructor(props: TorrentInstanceProps) {
    this.username = props.username;
    this.scgiPort = props.scgiPort;
    this.rtorrentPort = props.rtorrentPort;
    this.watchDirs = props.watchDirs;
    this.allowPublicTracker = props.allowPublicTracker;
    this.recycling = props.recycling;
    this.syncDisabled = props.syncDisabled;
  }

  static provision(
    props: Pick<TorrentInstanceProps, 'username' | 'scgiPort' | 'rtorrentPort'>,
  ): { instance: TorrentInstance; event: RtorrentInstanceProvisioned } {
    const instance = new TorrentInstance({
      ...props,
      watchDirs: [WatchDir.root()],
      allowPublicTracker: false,
      recycling: RecyclingMode.none,
      syncDisabled: false,
    });
    return {
      instance,
      event: { type: 'RtorrentInstanceProvisioned', username: props.username.value },
    };
  }

  // Rehydration from persistence — no event, state is whatever was stored.
  static restore(props: TorrentInstanceProps): TorrentInstance {
    return new TorrentInstance(props);
  }

  addWatchDir(label: Label): { instance: TorrentInstance; event?: WatchDirAdded } {
    if (this.hasFolder(label)) {
      return { instance: this };
    }
    return {
      instance: new TorrentInstance({
        ...this.props(),
        watchDirs: [...this.watchDirs, WatchDir.labeled(label)],
      }),
      event: { type: 'WatchDirAdded', username: this.username.value, label: label.value },
    };
  }

  // Whether the folder's directories hold nothing is for the caller to have
  // checked on disk: the instance only stops knowing the name. One already
  // gone is a job run twice, not an error.
  removeWatchDir(label: Label): TorrentInstance {
    if (!this.hasFolder(label)) {
      return this;
    }
    return new TorrentInstance({
      ...this.props(),
      watchDirs: this.watchDirs.filter((dir) => dir.label?.equals(label) !== true),
    });
  }

  // The folder keeps its place and what happens to its finished downloads;
  // only its name changes. Renamed already (old name gone, new one there) is a
  // job run twice.
  renameWatchDir(from: Label, to: Label): TorrentInstance {
    if (!this.hasFolder(from) && this.hasFolder(to)) {
      return this;
    }
    if (!this.hasFolder(from)) {
      throw new UnknownCategoryError(from.value);
    }
    if (this.hasFolder(to)) {
      throw new FolderNameTakenError(to.value);
    }
    return new TorrentInstance({
      ...this.props(),
      watchDirs: this.watchDirs.map((dir) =>
        dir.label?.equals(from) === true ? WatchDir.labeled(to, dir.syncMode) : dir,
      ),
    });
  }

  // Only a category this instance actually owns can carry a mode: a label whose
  // directories were never created would push from a path that does not exist.
  setSyncMode(label: Label, mode: SyncMode): TorrentInstance {
    if (!this.hasFolder(label)) {
      throw new UnknownCategoryError(label.value);
    }
    return new TorrentInstance({
      ...this.props(),
      watchDirs: this.watchDirs.map((dir) =>
        dir.label?.equals(label) === true ? dir.withSyncMode(mode) : dir,
      ),
    });
  }

  setRecycling(mode: RecyclingMode): TorrentInstance {
    return this.recycling.equals(mode)
      ? this
      : new TorrentInstance({ ...this.props(), recycling: mode });
  }

  setAllowPublicTracker(allowed: boolean): TorrentInstance {
    if (this.allowPublicTracker === allowed) {
      return this;
    }
    return new TorrentInstance({ ...this.props(), allowPublicTracker: allowed });
  }

  setSyncDisabled(disabled: boolean): TorrentInstance {
    if (this.syncDisabled === disabled) {
      return this;
    }
    return new TorrentInstance({ ...this.props(), syncDisabled: disabled });
  }

  admitTorrent(privacy: TorrentPrivacy): AdmissionDecision {
    if (privacy === 'public' && !this.allowPublicTracker) {
      return 'rejected-public-tracker';
    }
    return 'accepted';
  }

  // rTorrent loads a dropped file stopped so its tracker can be vetted first:
  // such a torrent is one nobody else will ever start. A file added any other
  // way (ruTorrent's upload form, a client over RPC) carries its owner's own
  // choice of starting it or not, which is theirs to keep.
  startsOnceAdmitted(torrentFile: string, home: string): boolean {
    return this.watchDirs.some((dir) => torrentFile.startsWith(`${dir.watchPath(home)}/`));
  }

  // Where a .torrent dropped into a watch folder is filed once added: the
  // torrents/ folder of the same category. Only a file sitting directly in one
  // of this member's watch folders has one.
  torrentsFolderFor(torrentFile: string, home: string): string | undefined {
    const parent = torrentFile.slice(0, torrentFile.lastIndexOf('/'));
    return this.watchDirs.find((dir) => dir.watchPath(home) === parent)?.torrentsPath(home);
  }

  hasFolder(label: Label): boolean {
    return this.watchDirs.some((dir) => dir.label?.equals(label) === true);
  }

  private props(): TorrentInstanceProps {
    return {
      username: this.username,
      scgiPort: this.scgiPort,
      rtorrentPort: this.rtorrentPort,
      watchDirs: this.watchDirs,
      allowPublicTracker: this.allowPublicTracker,
      recycling: this.recycling,
      syncDisabled: this.syncDisabled,
    };
  }
}
