import type { Username } from '../user/Username.js';
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
