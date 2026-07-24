import type { IpAddress } from '../shared/IpAddress.js';
import type { Username } from '../user/Username.js';
import type { Blocklist } from './Blocklist.js';
import type { BlocklistSource } from './BlocklistSource.js';
import type { Tracker } from './Tracker.js';
import type { TrackerHost } from './TrackerHost.js';
import type { TrackerPort } from './TrackerPort.js';
import type { TrackerEvent } from './events.js';

export interface TrackerRepository {
  findByHost(host: TrackerHost): Promise<Tracker | undefined>;
  listAll(): Promise<readonly Tracker[]>;
  listNeedingCertCheck(today: string): Promise<readonly Tracker[]>;
  save(tracker: Tracker): Promise<Tracker>;
}

export interface BlocklistRepository {
  listAll(): Promise<readonly Blocklist[]>;
  listEnabled(): Promise<readonly Blocklist[]>;
  findBySourceAuthorName(
    source: BlocklistSource,
    author: string,
    name: string,
  ): Promise<Blocklist | undefined>;
  save(blocklist: Blocklist): Promise<Blocklist>;
}

export interface UserAddress {
  readonly username: Username;
  readonly ip: IpAddress;
}

export interface UserAddressRepository {
  listAll(): Promise<readonly UserAddress[]>;
  add(username: Username, ip: IpAddress): Promise<void>;
  remove(username: Username, ip: IpAddress): Promise<void>;
}

export interface FetchedCert {
  readonly pem: string;
  readonly expiresOn: string; // ISO YYYY-MM-DD
}

// undefined = no TLS answer (timeout, refused, no certificate presented) —
// a normal outcome for plain-http trackers, NOT an exception path.
export interface TrackerCertPort {
  fetch(host: TrackerHost, port: TrackerPort): Promise<FetchedCert | undefined>;
}

export interface CertStorePort {
  install(host: TrackerHost, pem: string): Promise<void>;
  remove(host: TrackerHost): Promise<void>;
  rehash(): Promise<void>;
}

// [] = NXDOMAIN / no A record — the "tracker is dead" signal.
export interface DnsResolverPort {
  resolveA(host: TrackerHost): Promise<readonly IpAddress[]>;
}

export interface DownloadedList {
  readonly ranges: readonly string[];
  readonly sha256: string;
}

// undefined = download or integrity failure; callers isolate per-list so one
// expired subscription never blocks the other lists (issue #117).
export interface BlocklistDownloadPort {
  fetch(url: string): Promise<DownloadedList | undefined>;
}

export interface CatalogEntry {
  readonly name: string;
  readonly author: string;
  readonly listId: string;
  readonly url: string;
  readonly subscription: boolean;
}

export interface IblocklistCatalogPort {
  fetchCatalog(): Promise<readonly CatalogEntry[]>;
}

export interface TrackerNotificationPort {
  notify(event: TrackerEvent): Promise<void>;
}

// Partnership seam with the Security context (AUDIT §2): Phase 2 renders the
// files; reloading the services is best-effort until Phase 3 owns them.
export interface NetworkServiceReloadPort {
  reloadDns(): Promise<void>;
  reloadPeerGuardian(): Promise<void>;
}
