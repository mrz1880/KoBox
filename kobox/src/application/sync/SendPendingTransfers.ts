import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import type { SyncTransfer } from '../../domain/sync/SyncTransfer.js';
import type {
  FileTransferPort,
  LocalFileFactsPort,
  RemotePasswordOpenerPort,
  SyncDestinationRepository,
  SyncTransferRepository,
} from '../../domain/sync/ports.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly users: UserRepository;
  readonly destinations: SyncDestinationRepository;
  readonly transfers: SyncTransferRepository;
  readonly opener: RemotePasswordOpenerPort;
  readonly transport: FileTransferPort;
  readonly facts: LocalFileFactsPort;
  readonly clock: () => string;
  // the hour it is right now, so the pass can tell whose turn it is
  readonly hour: () => number;
}

// The pass that carries waiting downloads across. Runs in the ROOT WORKER: it
// opens sealed passwords and reads files under members' homes.
//
// One hourly system pass, not a crontab per member. MySB wrote a cron line into
// each member's crontab so they could pick their hour; the hour is still theirs,
// but nothing here writes into anybody's crontab.
export class SendPendingTransfers {
  constructor(private readonly deps: Deps) {}

  // `only` sends one member's queue immediately, whatever hour it is — that is
  // the "send it straight away" folders. Without it, the pass is the scheduled
  // one and takes on whoever's hour has come.
  async execute(only?: Username): Promise<void> {
    const members =
      only === undefined
        ? (await this.deps.users.listAll()).map((user) => user.username)
        : [only];
    for (const username of members) {
      // one member's broken destination must never stop the others' transfers
      try {
        await this.forMember(username, only !== undefined);
      } catch {
        continue;
      }
    }
  }

  private async forMember(username: Username, immediate: boolean): Promise<void> {
    const destination = await this.deps.destinations.findByUsername(username);
    if (destination === undefined) {
      return; // nothing configured: nothing to send, and not an error
    }
    if (!immediate && !destination.sendHour.hasCome(this.deps.hour())) {
      return; // not their hour yet
    }
    const limit = destination.batchSize.isUnlimited ? undefined : destination.batchSize.value;
    const waiting = await this.deps.transfers.listWaiting(username, limit);
    if (waiting.length === 0) {
      return;
    }
    const password = await this.deps.opener.open(destination.sealedPassword);
    for (const transfer of waiting) {
      await this.sendOne(transfer, destination, password);
    }
  }

  private async sendOne(
    transfer: SyncTransfer,
    destination: SyncDestination,
    password: Awaited<ReturnType<RemotePasswordOpenerPort['open']>>,
  ): Promise<void> {
    // the attempt is recorded before the copy starts: a pass killed mid-transfer
    // must still leave a trace that it tried
    const sending = transfer.start(this.deps.clock());
    await this.deps.transfers.save(sending);

    if (!(await this.deps.facts.exists(transfer.source))) {
      // the member deleted it between the download finishing and the pass
      await this.deps.transfers.save(
        sending.fail('the file is no longer on the box', this.deps.clock()),
      );
      return;
    }
    const remoteFolder = (await this.deps.facts.isDirectory(transfer.source))
      ? destination.folderFor(transfer.label.value)
      : destination.folderForLoneFile(transfer.label.value, transfer.name);

    const outcome = await this.deps.transport.send({
      destination,
      password,
      source: transfer.source,
      remoteFolder,
    });
    await this.deps.transfers.save(
      outcome.ok
        ? sending.succeed(this.deps.clock())
        : sending.fail(outcome.detail ?? 'it did not go through', this.deps.clock()),
    );
  }
}
