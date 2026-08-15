import { LoneFilePlacement } from '../../domain/sync/LoneFilePlacement.js';
import type { RemoteAccount } from '../../domain/sync/RemoteAccount.js';
import type { RemoteHost } from '../../domain/sync/RemoteHost.js';
import type { RemotePassword } from '../../domain/sync/RemotePassword.js';
import type { RemotePath } from '../../domain/sync/RemotePath.js';
import type { RemotePort } from '../../domain/sync/RemotePort.js';
import { SyncDestination } from '../../domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../domain/sync/TransferBatchSize.js';
import type {
  RemotePasswordSealerPort,
  SyncDestinationRepository,
} from '../../domain/sync/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { DomainError } from '../../domain/shared/DomainError.js';

export class NoDestinationToUpdateError extends DomainError {
  constructor(username: string) {
    super(`${username} has no destination yet, so there is no password to keep`);
  }
}

export interface SetSyncDestinationCommand {
  readonly username: Username;
  readonly host: RemoteHost;
  readonly port: RemotePort;
  readonly account: RemoteAccount;
  readonly path: RemotePath;
  readonly batchSize: TransferBatchSize;
  readonly placement: LoneFilePlacement;
  // absent means "leave the stored one alone": a form cannot show a password
  // back, so an empty field must not erase what is there
  readonly password?: RemotePassword;
}

interface Deps {
  readonly destinations: SyncDestinationRepository;
  readonly sealer: RemotePasswordSealerPort;
}

// Runs in the PORTAL, not the worker: it only ever seals, which needs the
// public half of the host key. Nothing here can read a password back.
export class SetSyncDestination {
  constructor(private readonly deps: Deps) {}

  async execute(command: SetSyncDestinationCommand): Promise<void> {
    const existing = await this.deps.destinations.findByUsername(command.username);
    if (command.password === undefined && existing === undefined) {
      // there is nothing to keep: a first destination has to carry a password
      throw new NoDestinationToUpdateError(command.username.value);
    }
    const sealedPassword =
      command.password === undefined
        ? (existing?.sealedPassword ?? '')
        : await this.deps.sealer.seal(command.password);

    const updated =
      existing === undefined
        ? SyncDestination.define({
            username: command.username,
            host: command.host,
            port: command.port,
            account: command.account,
            sealedPassword,
            path: command.path,
            batchSize: command.batchSize,
            placement: command.placement,
          })
        : this.applyTo(existing, command, sealedPassword);

    await this.deps.destinations.save(updated);
  }

  private applyTo(
    existing: SyncDestination,
    command: SetSyncDestinationCommand,
    sealedPassword: string,
  ): SyncDestination {
    // the aggregate decides what a change invalidates: moving the destination
    // drops the last verdict, changing a preference keeps it
    const reconnected = existing.withConnection({
      host: command.host,
      port: command.port,
      account: command.account,
      path: command.path,
    });
    const withSecret =
      command.password === undefined ? reconnected : reconnected.withPassword(sealedPassword);
    return withSecret.withBatchSize(command.batchSize).withPlacement(command.placement);
  }
}
