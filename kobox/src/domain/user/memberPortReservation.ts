import type { RtorrentPort, ScgiPort } from './Port.js';

// The ports a member's rtorrent keeps listening on. Both sit inside the
// kernel's ephemeral range (32768-60999 by default), from which it picks the
// source port of every outgoing connection. While a member's rtorrent is down,
// such a connection can take its port, and the TIME_WAIT it leaves makes the
// next bind fail for a minute (rtorrent sets SO_REUSEADDR, the borrowing socket
// does not). The host therefore reserves every port handed to a member, and
// only those: a fixed block would miss a port kept from a MySB import.
export type MemberPort = ScgiPort | RtorrentPort;

interface PortRange {
  readonly first: number;
  readonly last: number;
}

function foldIntoRanges(numbers: readonly number[]): readonly PortRange[] {
  return numbers.reduce<PortRange[]>((ranges, port) => {
    const previous = ranges.at(-1);
    if (previous !== undefined && port === previous.last + 1) {
      ranges[ranges.length - 1] = { first: previous.first, last: port };
    } else {
      ranges.push({ first: port, last: port });
    }
    return ranges;
  }, []);
}

function formatRange(range: PortRange): string {
  return range.first === range.last
    ? String(range.first)
    : `${String(range.first)}-${String(range.last)}`;
}

// The value of net.ipv4.ip_local_reserved_ports: ascending, consecutive ports
// folded into ranges ("45000-45001,51101"), empty when no member holds one.
export function reservedPortsValue(ports: readonly MemberPort[]): string {
  const ascending = ports.map((port) => port.value).sort((a, b) => a - b);
  return foldIntoRanges(ascending)
    .map(formatRange)
    .join(',');
}
