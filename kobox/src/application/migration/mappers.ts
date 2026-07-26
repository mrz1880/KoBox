import { DynDnsHost } from '../../domain/security/DynDnsHost.js';
import { IpAddress } from '../../domain/shared/IpAddress.js';
import { Blocklist } from '../../domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../domain/tracker/BlocklistUrl.js';
import { CheckState } from '../../domain/tracker/CheckState.js';
import { Tracker } from '../../domain/tracker/Tracker.js';
import { TrackerHost } from '../../domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../domain/tracker/TrackerProto.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { Label } from '../../domain/torrent/Label.js';
import { Torrent } from '../../domain/torrent/Torrent.js';
import { TorrentState } from '../../domain/torrent/TorrentState.js';
import { AccountType } from '../../domain/user/AccountType.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { ProxyPort, RtorrentPort, ScgiPort } from '../../domain/user/Port.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import type { MysbAddress, MysbBlocklist, MysbTorrent, MysbTracker, MysbUser } from './MysbSourcePort.js';

// Pure prod→VO mappers. Zod already validated row shapes at the source
// boundary; here the Value Objects are the authoritative gate — a row that
// offends an invariant (reserved username, bad host) throws a DomainError,
// which the import use case turns into a per-row conflict.

export interface MappedUser {
  readonly username: Username;
  readonly email: EmailAddress;
  readonly accountType: AccountType;
  readonly quota: Quota;
  readonly scgiPort: ScgiPort;
  readonly rtorrentPort: RtorrentPort;
  readonly proxyPort: ProxyPort;
  readonly suspended: boolean;
  readonly syncDisabled: boolean;
}

export function toMappedUser(dto: MysbUser): MappedUser {
  return {
    username: Username.parse(dto.username),
    email: EmailAddress.parse(dto.email),
    accountType: AccountType.parse(dto.accountType),
    quota: Quota.bytes(dto.quotaBytes),
    scgiPort: ScgiPort.parse(dto.scgiPort),
    rtorrentPort: RtorrentPort.parse(dto.rtorrentPort),
    proxyPort: ProxyPort.parse(dto.proxyPort),
    suspended: !dto.active,
    syncDisabled: dto.syncDisabled,
  };
}

export function toTracker(dto: MysbTracker): Tracker {
  const proto = TrackerProto.parse(dto.proto);
  // import identity only; a live, checkable tracker is queued for a real cert
  // fetch, dead or non-TLS ones are left idle (KoBox regenerates the rest).
  const checkState = proto.isCheckable && !dto.isDead ? 'pending' : 'none';
  return Tracker.restore({
    host: TrackerHost.parse(dto.host),
    proto,
    port: TrackerPort.parse(dto.port),
    privacy: TrackerPrivacy.parse(dto.privacy),
    isActive: dto.isActive,
    isDead: dto.isDead,
    isSsl: dto.isSsl,
    checkState: CheckState.parse(checkState),
    ipv4: dto.ipv4.map((ip) => IpAddress.parse(ip)),
  });
}

export function toBlocklist(dto: MysbBlocklist): Blocklist {
  return Blocklist.restore({
    source: BlocklistSource.parse(dto.source),
    author: dto.author,
    name: dto.name,
    url: BlocklistUrl.parse(dto.url),
    subscription: dto.subscription,
    enabled: dto.enabled,
  });
}

export interface MappedTorrent {
  readonly username: Username;
  readonly torrent: Torrent;
}

export function toTorrent(dto: MysbTorrent): MappedTorrent {
  const base = {
    infoHash: InfoHash.parse(dto.infoHash),
    name: dto.name,
    state: TorrentState.parse(dto.state),
  };
  const torrent = Torrent.restore(
    dto.label !== undefined ? { ...base, label: Label.parse(dto.label) } : base,
  );
  return { username: Username.parse(dto.username), torrent };
}

export type MappedAddress =
  | { readonly username: Username; readonly kind: 'ipv4'; readonly ip: IpAddress }
  | { readonly username: Username; readonly kind: 'hostname'; readonly hostname: DynDnsHost };

export function toMappedAddress(dto: MysbAddress): MappedAddress {
  const username = Username.parse(dto.username);
  if (dto.kind === 'ipv4') {
    return { username, kind: 'ipv4', ip: IpAddress.parse(dto.value) };
  }
  return { username, kind: 'hostname', hostname: DynDnsHost.parse(dto.value) };
}
