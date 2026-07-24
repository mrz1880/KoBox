import { DomainError } from '../shared/DomainError.js';
import type { InfoHash } from './InfoHash.js';
import type { Label } from './Label.js';
import { TorrentState } from './TorrentState.js';

export class InvalidTorrentNameError extends DomainError {
  constructor() {
    super('torrent name must not be empty');
  }
}

interface TorrentProps {
  readonly infoHash: InfoHash;
  readonly name: string;
  readonly state: TorrentState;
  readonly label?: Label;
  readonly tree?: string;
}

// A torrent tracked by an instance. Identity is (username, infoHash) — the
// username lives on the owning aggregate, repositories scope by it.
export class Torrent {
  readonly infoHash: InfoHash;
  readonly name: string;
  readonly state: TorrentState;
  readonly label: Label | undefined;
  readonly tree: string | undefined;

  private constructor(props: TorrentProps) {
    this.infoHash = props.infoHash;
    this.name = props.name;
    this.state = props.state;
    this.label = props.label;
    this.tree = props.tree;
  }

  static load(props: Omit<TorrentProps, 'state' | 'tree'>): Torrent {
    if (props.name.trim() === '') {
      throw new InvalidTorrentNameError();
    }
    return new Torrent({ ...props, state: TorrentState.loaded });
  }

  static restore(props: TorrentProps): Torrent {
    return new Torrent(props);
  }

  complete(tree: string): Torrent {
    return new Torrent({ ...this.props(), state: TorrentState.completed, tree });
  }

  reject(): Torrent {
    return new Torrent({ ...this.props(), state: TorrentState.rejected });
  }

  private props(): TorrentProps {
    return {
      infoHash: this.infoHash,
      name: this.name,
      state: this.state,
      ...(this.label !== undefined && { label: this.label }),
      ...(this.tree !== undefined && { tree: this.tree }),
    };
  }
}
