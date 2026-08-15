import type { Username } from '../user/Username.js';
import { LoneFilePlacement } from './LoneFilePlacement.js';
import type { RemoteAccount } from './RemoteAccount.js';
import type { RemoteHost } from './RemoteHost.js';
import type { RemotePath } from './RemotePath.js';
import type { RemotePort } from './RemotePort.js';
import type { SendHour } from './SendHour.js';
import type { TransferBatchSize } from './TransferBatchSize.js';

// What the last "test it now" concluded, in words the page can show as they are.
export interface ConnectionCheck {
  readonly ok: boolean;
  readonly at: string;
  readonly detail?: string;
  // the host key we saw, so a change can be reported rather than accepted
  readonly fingerprint?: string;
}

interface SyncDestinationProps {
  readonly username: Username;
  readonly host: RemoteHost;
  readonly port: RemotePort;
  readonly account: RemoteAccount;
  // sealed with the host RSA key: the portal can write one and never open one
  readonly sealedPassword: string;
  readonly path: RemotePath;
  readonly batchSize: TransferBatchSize;
  readonly placement: LoneFilePlacement;
  readonly sendHour: SendHour;
  readonly lastCheck?: ConnectionCheck;
}

export interface ConnectionSettings {
  readonly host: RemoteHost;
  readonly port: RemotePort;
  readonly account: RemoteAccount;
  readonly path: RemotePath;
}

// Where one member's finished downloads go. One per member, identified by the
// username — the legacy stored the same thing in a single-row `ident` table.
//
// The password is only ever held sealed. Nothing on this aggregate can open it:
// that takes the private half of the host key, which only the root worker reads.
export class SyncDestination {
  readonly username: Username;
  readonly host: RemoteHost;
  readonly port: RemotePort;
  readonly account: RemoteAccount;
  readonly sealedPassword: string;
  readonly path: RemotePath;
  readonly batchSize: TransferBatchSize;
  readonly placement: LoneFilePlacement;
  readonly sendHour: SendHour;
  readonly lastCheck?: ConnectionCheck;

  private constructor(props: SyncDestinationProps) {
    this.username = props.username;
    this.host = props.host;
    this.port = props.port;
    this.account = props.account;
    this.sealedPassword = props.sealedPassword;
    this.path = props.path;
    this.batchSize = props.batchSize;
    this.placement = props.placement;
    this.sendHour = props.sendHour;
    if (props.lastCheck !== undefined) {
      this.lastCheck = props.lastCheck;
    }
  }

  static define(props: Omit<SyncDestinationProps, 'lastCheck'>): SyncDestination {
    return new SyncDestination(props);
  }

  static restore(props: SyncDestinationProps): SyncDestination {
    return new SyncDestination(props);
  }

  // A category always becomes a folder of its own name, the way the legacy did:
  // a member browsing their NAS finds the same names they chose here.
  folderFor(category: string): string {
    return this.path.join(category);
  }

  // Only for a download that is a single file. One that produced a directory
  // keeps its own directory either way.
  folderForLoneFile(category: string, filename: string): string {
    if (!this.placement.needsItsOwnFolder) {
      return this.folderFor(category);
    }
    const withoutExtension = filename.replace(/\.[^.]+$/, '');
    return `${this.folderFor(category)}/${withoutExtension}`;
  }

  // The password is deliberately absent: the form cannot show one back, so an
  // untouched password field must mean "leave it alone", not "erase it".
  //
  // Built from connection() rather than props(): any earlier verdict was earned
  // against the old host, account or path and says nothing about the new one.
  withConnection(settings: ConnectionSettings): SyncDestination {
    return new SyncDestination({ ...this.connection(), ...settings });
  }

  // Same reasoning: a different password is a different question.
  withPassword(sealedPassword: string): SyncDestination {
    return new SyncDestination({ ...this.connection(), sealedPassword });
  }

  // These two change what happens AFTER the machine answers, so a verdict about
  // whether it answers at all survives them.
  withPlacement(placement: LoneFilePlacement): SyncDestination {
    return new SyncDestination({ ...this.props(), placement });
  }

  withBatchSize(batchSize: TransferBatchSize): SyncDestination {
    return new SyncDestination({ ...this.props(), batchSize });
  }

  withSendHour(sendHour: SendHour): SyncDestination {
    return new SyncDestination({ ...this.props(), sendHour });
  }

  recordCheck(check: ConnectionCheck): SyncDestination {
    return new SyncDestination({ ...this.connection(), lastCheck: check });
  }

  // everything except the verdict
  private connection(): Omit<SyncDestinationProps, 'lastCheck'> {
    return {
      username: this.username,
      host: this.host,
      port: this.port,
      account: this.account,
      sealedPassword: this.sealedPassword,
      path: this.path,
      batchSize: this.batchSize,
      placement: this.placement,
      sendHour: this.sendHour,
    };
  }

  private props(): SyncDestinationProps {
    return {
      ...this.connection(),
      ...(this.lastCheck !== undefined && { lastCheck: this.lastCheck }),
    };
  }
}
