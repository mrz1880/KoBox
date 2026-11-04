// Where the ports a member's rtorrent listens on are handed out from, upward
// and lowest free first: one SCGI port on loopback (ruTorrent and the portal
// talk to it) and one torrent port that peers reach.
export const FIRST_SCGI_PORT = 51101;
export const FIRST_RTORRENT_PORT = 45000;
