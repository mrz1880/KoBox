import { DomainError } from '../shared/DomainError.js';

export class InvalidTorrentStateError extends DomainError {
  constructor(raw: string) {
    super(`invalid torrent state ${JSON.stringify(raw)}`);
  }
}

export type TorrentStateValue = 'loaded' | 'completed' | 'rejected';

// Closed set of persisted torrent states; an erased torrent has no row.
export class TorrentState {
  static readonly loaded = new TorrentState('loaded');
  static readonly completed = new TorrentState('completed');
  static readonly rejected = new TorrentState('rejected');

  private constructor(readonly value: TorrentStateValue) {}

  static parse(raw: string): TorrentState {
    switch (raw) {
      case 'loaded':
        return TorrentState.loaded;
      case 'completed':
        return TorrentState.completed;
      case 'rejected':
        return TorrentState.rejected;
      default:
        throw new InvalidTorrentStateError(raw);
    }
  }
}
