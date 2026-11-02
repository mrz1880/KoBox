import { CONFIG_DROP_IN_TREE, FINISH_SCRIPTS_TREE } from './memberTrees.js';
import { SessionDir } from './SessionDir.js';
import { WatchDir } from './WatchDir.js';

// What lets a member's rtorrent start again on its own after /home is lost:
// its session (the torrent list and each torrent's resume state), the .torrent
// files it keeps, the member's own drop-ins and finish scripts. Relative to
// the member's home. Downloads stay out (rtorrent fetches them again), and so
// does whatever KoBox renders (.rtorrent.rc, hooks): install writes them back.
// The labeled watch dirs keep their torrents under the root's tree, so the
// root's tree covers them all.
export function restartKitTrees(): readonly string[] {
  return [
    SessionDir.TREE,
    WatchDir.root().torrentsTree(),
    CONFIG_DROP_IN_TREE,
    FINISH_SCRIPTS_TREE,
  ];
}
