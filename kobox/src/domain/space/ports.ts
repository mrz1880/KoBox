import type { FinishedTorrent } from './FinishedTorrent.js';
import type { ScgiPort } from '../user/Port.js';

// What the space context needs from a member's rTorrent: the torrents whose
// data is complete, with what they take and what they gave back.
export interface MemberTorrentsPort {
  listFinished(scgiPort: ScgiPort): Promise<readonly FinishedTorrent[]>;
}
