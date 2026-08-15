import type { ProbeOutcome } from '../../domain/sync/ports.js';
import type {
  RemotePasswordOpenerPort,
  RemoteProbePort,
  SyncDestinationRepository,
} from '../../domain/sync/ports.js';
import type { RemotePassword } from '../../domain/sync/RemotePassword.js';
import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly destinations: SyncDestinationRepository;
  readonly opener: RemotePasswordOpenerPort;
  readonly probe: RemoteProbePort;
  readonly clock: () => string;
}

// Runs in the ROOT WORKER: opening the sealed password needs the private half
// of the host key, which the portal cannot read. The portal only enqueues.
export class CheckSyncDestination {
  constructor(private readonly deps: Deps) {}

  async execute(username: Username): Promise<void> {
    const destination = await this.deps.destinations.findByUsername(username);
    if (destination === undefined) {
      return; // nothing configured: nothing to check, and not an error
    }
    const outcome = await this.probeOrExplain(destination);
    await this.deps.destinations.save(
      destination.recordCheck({ ...outcome, at: this.deps.clock() }),
    );
  }

  private async probeOrExplain(destination: SyncDestination): Promise<ProbeOutcome> {
    // Two failures, two different things to do about them — so two catches. One
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
        detail: 'the stored password could not be read on this box — type it in again',
      };
    }
    try {
      return await this.deps.probe.probe(destination, password);
    } catch {
      // the check machinery itself is broken (a missing binary, a refused
      // spawn). That is ours to fix, not theirs.
      return { ok: false, detail: 'the test could not run on this box — tell your admin' };
    }
  }
}
