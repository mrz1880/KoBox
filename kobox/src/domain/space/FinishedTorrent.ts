import type { InfoHash } from '../torrent/InfoHash.js';
import type { Quota } from '../user/Quota.js';

// The space context's view of a torrent in a member's rTorrent: what it takes,
// how much it gave back and since when it is complete. `finishedAt` is missing
// while the download is still running.
export interface FinishedTorrent {
  readonly infoHash: InfoHash;
  readonly name: string;
  readonly size: Quota;
  readonly ratio: number;
  readonly finishedAt?: string | undefined;
  readonly path: string;
}
