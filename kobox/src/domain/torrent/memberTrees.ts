// Trees of a member's home that several parts of KoBox name, relative to that
// home. The rtorrent.rc template spells config.d once more on its own side
// (cfg.basedir + "config.d/"): rtorrent resolves it there, KoBox writes into it
// from here, and the torrent rendering golden tests show both.

// rtorrent's drop-in directory: KoBox's 80-*.rc files and the member's own 99-*.rc
export const CONFIG_DROP_IN_TREE = 'rtorrent/config.d';

// the member's own shell scripts, run after each finished download
export const FINISH_SCRIPTS_TREE = 'scripts';
