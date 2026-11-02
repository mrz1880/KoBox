import type { FinishedTorrent } from './FinishedTorrent.js';
import type { InfoHash } from '../torrent/InfoHash.js';
import type { ScgiPort } from '../user/Port.js';

// What the space context needs from a member's rTorrent: the torrents whose
// data is complete, with what they take and what they gave back, and a way to
// drop one. Erasing leaves the data on disk: removing it is another port's job.
export interface MemberTorrentsPort {
  listFinished(scgiPort: ScgiPort): Promise<readonly FinishedTorrent[]>;
  erase(scgiPort: ScgiPort, infoHash: InfoHash): Promise<void>;
}
