import type { HostKeyFingerprint } from '../../domain/sync/HostKeyFingerprint.js';
import type { SyncDestination } from '../../domain/sync/SyncDestination.js';
import type { SyncTransfer } from '../../domain/sync/SyncTransfer.js';
import { TransferFailure } from '../../domain/sync/TransferFailure.js';
import type {
  FileTransferPort,
  LocalFileFactsPort,
  RemotePasswordOpenerPort,
  SyncDestinationRepository,
  SyncTransferRepository,
} from '../../domain/sync/ports.js';
import type { MailOutboxPort } from '../maintenance/MailOutboxPort.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly users: UserRepository;
  readonly destinations: SyncDestinationRepository;
  readonly transfers: SyncTransferRepository;
  // what the member chose to hear about goes out through the mail queue
  readonly outbox: MailOutboxPort;
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

  // `only` sends one member's queue immediately, whatever hour it is: that is
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
    let identity: HostKeyFingerprint | undefined;
    for (const transfer of waiting) {
      identity = (await this.sendOne(transfer, destination, password)) ?? identity;
    }
    if (identity !== undefined) {
      await this.recordIdentity(destination, identity);
    }
  }

  // The machine's identity, as this pass met it, goes where the check puts it.
  // Read again first: the member may have saved their destination while the
  // files went out, and that save must not be undone.
  private async recordIdentity(
    contacted: SyncDestination,
    identity: HostKeyFingerprint,
  ): Promise<void> {
    const current = await this.deps.destinations.findByUsername(contacted.username);
    if (current !== undefined) {
      await this.deps.destinations.save(current.recognise(identity, contacted));
    }
  }

  // what the machine presented itself as, when the transfer reached it
  private async sendOne(
    transfer: SyncTransfer,
    destination: SyncDestination,
    password: Awaited<ReturnType<RemotePasswordOpenerPort['open']>>,
  ): Promise<HostKeyFingerprint | undefined> {
    // the attempt is recorded before the copy starts: a pass killed mid-transfer
    // must still leave a trace that it tried
    const sending = transfer.start(this.deps.clock());
    await this.deps.transfers.save(sending);

    if (!(await this.deps.facts.exists(transfer.source))) {
      // the member deleted it between the download finishing and the pass
      await this.finish(
        sending.fail(TransferFailure.explained('source-gone'), this.deps.clock()),
        destination,
      );
      return undefined;
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
    await this.finish(
      outcome.ok
        ? sending.succeed(this.deps.clock())
        : sending.fail(
            outcome.failure ?? TransferFailure.explained('unexplained'),
            this.deps.clock(),
          ),
      destination,
    );
    return outcome.identity;
  }

  private async finish(transfer: SyncTransfer, destination: SyncDestination): Promise<void> {
    await this.deps.transfers.save(transfer);
    if (destination.wantsMailAbout(transfer.state)) {
      await this.tell(transfer);
    }
  }

  // Best-effort: the transfer is recorded either way, and a mail that cannot
  // be queued must not turn a file that arrived into a failed pass.
  private async tell(transfer: SyncTransfer): Promise<void> {
    try {
      const user = await this.deps.users.findByUsername(transfer.username);
      if (user === undefined) {
        return;
      }
      await this.deps.outbox.enqueue(
        { recipient: user.email.value, ...transferMail(transfer) },
        this.deps.clock(),
      );
    } catch {
      return;
    }
  }
}

function transferMail(transfer: SyncTransfer): { subject: string; body: string } {
  if (transfer.state === 'sent') {
    return {
      subject: `${transfer.name} arrived`,
      body: `${transfer.name}, from your ${transfer.label.value} folder, has arrived on your own machine.\n`,
    };
  }
  return {
    subject: `${transfer.name} did not arrive`,
    body: [
      `${transfer.name}, from your ${transfer.label.value} folder, could not be sent to your own machine:`,
      `${(transfer.failure ?? TransferFailure.explained('unexplained')).record}.`,
      '',
      'It stays under Folders on your seedbox, where you can try it again.',
      '',
    ].join('\n'),
  };
}
