import { departureOf } from '../../domain/sync/Departure.js';
import type { HostKeyTrust } from '../../domain/sync/HostKeyTrust.js';
import type { ProbeOutcome } from '../../domain/sync/ports.js';
import type {
  RemotePasswordOpenerPort,
  RemoteProbePort,
  SyncDestinationRepository,
  SyncTransferRepository,
} from '../../domain/sync/ports.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { RemotePassword } from '../../domain/sync/RemotePassword.js';
import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import type { Username } from '../../domain/user/Username.js';

// What the check did beyond its verdict, for what follows it
export interface CheckReport {
  // true when a transfer it put back leaves at once, from a folder that sends
  // straight away, rather than at the member's hour
  readonly sendNow: boolean;
}

// what a working check put back, and whether any of it leaves at once
interface PutBack {
  readonly requeued: number;
  readonly sendNow: boolean;
}

const NOTHING_PUT_BACK: PutBack = { requeued: 0, sendNow: false };
const NOTHING_TO_SEND: CheckReport = { sendNow: false };

interface Deps {
  readonly destinations: SyncDestinationRepository;
  // the member's transfers that failed, some of which a working check clears
  readonly transfers: Pick<SyncTransferRepository, 'listFailed' | 'save'>;
  // the folders and how each one sends: they decide when a transfer leaves
  readonly instances: Pick<TorrentInstanceRepository, 'findByUsername'>;
  readonly opener: RemotePasswordOpenerPort;
  readonly probe: RemoteProbePort;
  readonly clock: () => string;
}

// Runs in the ROOT WORKER: opening the sealed password needs the private half
// of the host key, which the portal cannot read. The portal only enqueues.
export class CheckSyncDestination {
  constructor(private readonly deps: Deps) {}

  // `trust` says whether this check may accept a new identity of the machine:
  // the member testing the connection may, the check following a save may not
  // (see HostKeyTrust)
  async execute(username: Username, trust: HostKeyTrust): Promise<CheckReport> {
    const destination = await this.deps.destinations.findByUsername(username);
    if (destination === undefined) {
      return NOTHING_TO_SEND; // nothing configured: nothing to check, and not an error
    }
    const { identity, ...verdict } = await this.probeOrExplain(destination, trust);
    // Read again: the probe takes seconds, and the member may have saved their
    // destination meanwhile. The aggregate keeps what they saved and drops a
    // verdict about what was there before.
    const current = await this.deps.destinations.findByUsername(username);
    if (current === undefined) {
      return NOTHING_TO_SEND; // removed during the probe: nothing left to record it on
    }
    const { requeued, sendNow } =
      verdict.ok && current.connectsAs(destination)
        ? await this.requeueWhatItFixed(username)
        : NOTHING_PUT_BACK;
    const checked = current.recordCheck(
      { ...verdict, at: this.deps.clock(), ...(requeued > 0 && { requeued }) },
      destination,
    );
    await this.deps.destinations.save(
      identity === undefined ? checked : checked.recognise(identity, destination),
    );
    return { sendNow };
  }

  // What failed for want of the connection this check found working goes back
  // in the queue, and leaves the way its folder sends (see Departure).
  private async requeueWhatItFixed(username: Username): Promise<PutBack> {
    const fixed = (await this.deps.transfers.listFailed(username)).filter((transfer) =>
      transfer.isFixedByAWorkingConnection(),
    );
    const folders = await this.deps.instances.findByUsername(username);
    let sendNow = false;
    for (const transfer of fixed) {
      await this.deps.transfers.save(transfer.requeue(this.deps.clock()));
      sendNow ||= departureOf(folders, transfer.label) === 'straight-away';
    }
    return { requeued: fixed.length, sendNow };
  }

  private async probeOrExplain(
    destination: SyncDestination,
    trust: HostKeyTrust,
  ): Promise<ProbeOutcome> {
    // Two failures, two different things to do about them, so two catches. One
    // catch around both would tell a member to retype a password that is
    // perfectly fine, and send them chasing the wrong thing.
    let password: RemotePassword;
    try {
      password = await this.deps.opener.open(destination.sealedPassword);
    } catch {
      // a database restored without its host key leaves passwords that cannot
      // be opened. Never echo the sealed blob back.
      return {
        ok: false,
        detail: 'the stored password could not be read on this box: type it in again',
      };
    }
    try {
      return await this.deps.probe.probe(destination, password, trust);
    } catch {
      // the check machinery itself is broken (a missing binary, a refused
      // spawn). That is ours to fix, not theirs.
      return { ok: false, detail: 'the test could not run on this box: tell your admin' };
    }
  }
}
