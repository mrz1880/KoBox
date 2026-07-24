import type { RtorrentPort, ScgiPort } from '../user/Port.js';
import type { Username } from '../user/Username.js';
import type { Label } from './Label.js';
import { WatchDir } from './WatchDir.js';
import type { RtorrentInstanceProvisioned, WatchDirAdded } from './events.js';

export type TorrentPrivacy = 'private' | 'public';
export type AdmissionDecision = 'accepted' | 'rejected-public-tracker';

interface TorrentInstanceProps {
  readonly username: Username;
  readonly scgiPort: ScgiPort;
  readonly rtorrentPort: RtorrentPort;
  readonly watchDirs: readonly WatchDir[];
  readonly allowPublicTracker: boolean;
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
  readonly syncDisabled: boolean;

  private constructor(props: TorrentInstanceProps) {
    this.username = props.username;
    this.scgiPort = props.scgiPort;
    this.rtorrentPort = props.rtorrentPort;
    this.watchDirs = props.watchDirs;
    this.allowPublicTracker = props.allowPublicTracker;
    this.syncDisabled = props.syncDisabled;
  }

  static provision(
    props: Pick<TorrentInstanceProps, 'username' | 'scgiPort' | 'rtorrentPort'>,
  ): { instance: TorrentInstance; event: RtorrentInstanceProvisioned } {
    const instance = new TorrentInstance({
      ...props,
      watchDirs: [WatchDir.root()],
      allowPublicTracker: false,
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
    if (this.watchDirs.some((dir) => dir.label?.equals(label))) {
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

  private props(): TorrentInstanceProps {
    return {
      username: this.username,
      scgiPort: this.scgiPort,
      rtorrentPort: this.rtorrentPort,
      watchDirs: this.watchDirs,
      allowPublicTracker: this.allowPublicTracker,
      syncDisabled: this.syncDisabled,
    };
  }
}
