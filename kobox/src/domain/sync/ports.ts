import type { Username } from '../user/Username.js';
import type { LocalPath } from './LocalPath.js';
import type { SyncTransfer, TransferState } from './SyncTransfer.js';
import type { RemotePassword } from './RemotePassword.js';
import type { SyncDestination } from './SyncDestination.js';

export interface SyncDestinationRepository {
  findByUsername(username: Username): Promise<SyncDestination | undefined>;
  save(destination: SyncDestination): Promise<void>;
  delete(username: Username): Promise<void>;
}

// Sealing and opening are two ports, not one, because two different processes
// hold two different halves: the non-root portal seals with the public key and
// must not be able to open anything, the root worker opens with the private one.
export interface RemotePasswordSealerPort {
  seal(password: RemotePassword): Promise<string>;
}

export interface RemotePasswordOpenerPort {
  open(sealed: string): Promise<RemotePassword>;
}

// What "test it now" found out, in words meant for the member rather than a
// stack trace. The timestamp is not here: the clock belongs to the use case.
export interface ProbeOutcome {
  readonly ok: boolean;
  readonly detail?: string;
  readonly fingerprint?: string;
}

// Reaches the member's own machine and comes back with an answer. Root-side:
// it opens a password the portal cannot read.
export interface RemoteProbePort {
  probe(destination: SyncDestination, password: RemotePassword): Promise<ProbeOutcome>;
}

export interface SyncTransferRepository {
  // undefined when this download is already queued — rTorrent can fire
  // `finished` more than once for one torrent
  queue(transfer: SyncTransfer): Promise<SyncTransfer | undefined>;
  save(transfer: SyncTransfer): Promise<void>;
  findById(id: number): Promise<SyncTransfer | undefined>;
  listWaiting(username: Username, limit?: number): Promise<readonly SyncTransfer[]>;
  listRecent(username: Username, limit: number): Promise<readonly SyncTransfer[]>;
  countByState(username: Username, state: TransferState): Promise<number>;
}

// What a finished download actually left on disk. A torrent that produced a
// directory and one that produced a single file are copied differently, and
// only the filesystem knows which happened.
export interface LocalFileFactsPort {
  isDirectory(path: LocalPath): Promise<boolean>;
  exists(path: LocalPath): Promise<boolean>;
}

export interface TransferOutcome {
  readonly ok: boolean;
  readonly detail?: string;
}

// Carries one finished download across. Root-side: it opens a password the
// portal cannot read, and reads files under a member's home.
export interface FileTransferPort {
  send(request: {
    readonly destination: SyncDestination;
    readonly password: RemotePassword;
    readonly source: LocalPath;
    readonly remoteFolder: string;
  }): Promise<TransferOutcome>;
}
