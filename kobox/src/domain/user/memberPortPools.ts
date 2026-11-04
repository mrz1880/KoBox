// Where the ports a member's rtorrent listens on are handed out from, upward
// and lowest free first: one SCGI port on loopback (ruTorrent and the portal
// talk to it) and one torrent port that peers reach.
export const FIRST_SCGI_PORT = 51101;
export const FIRST_RTORRENT_PORT = 45000;

// Both pools sit inside the kernel's ephemeral range (32768-60999), from which
// it picks the source port of every outgoing connection. While a member's
// rtorrent is down, such a connection can take its port, and the TIME_WAIT it
// leaves behind makes rtorrent's bind fail for a minute (rtorrent sets
// SO_REUSEADDR, the borrowing socket does not). The host reserves this many
// ports from the start of each pool, far more members than one box holds.
const RESERVED_PORTS_PER_POOL = 1000;

export interface PortPool {
  readonly first: number;
  readonly last: number;
}

function poolFrom(first: number): PortPool {
  return { first, last: first + RESERVED_PORTS_PER_POOL - 1 };
}

export const MEMBER_PORT_POOLS: readonly PortPool[] = [
  poolFrom(FIRST_RTORRENT_PORT),
  poolFrom(FIRST_SCGI_PORT),
];
