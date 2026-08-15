import { DomainError } from '../shared/DomainError.js';
import type { Label } from '../torrent/Label.js';
import type { Username } from '../user/Username.js';
import type { LocalPath } from './LocalPath.js';

export class TransferNotRetryableError extends DomainError {
  constructor(state: string) {
    super(`a transfer that is ${state} cannot be put back in the queue`);
  }
}

export class TransferAlreadyOnItsWayError extends DomainError {
  constructor() {
    super('this transfer is already on its way');
  }
}

export type TransferState = 'waiting' | 'sending' | 'sent' | 'failed';

interface SyncTransferProps {
  readonly id?: number;
  readonly username: Username;
  readonly label: Label;
  readonly source: LocalPath;
  readonly state: TransferState;
  readonly attempts: number;
  readonly lastError?: string;
  readonly queuedAt: string;
  readonly updatedAt: string;
}

// One finished download on its way to a member's own machine. The legacy kept
// the same thing in a per-user `list` table, driven from bash.
//
// The state machine is small on purpose: waiting -> sending -> sent or failed,
// and a member may push a failed one back to waiting. Nothing else is legal, and
// the aggregate is what says so — a second pass starting a transfer that is
// already on its way would send the same file twice.
export class SyncTransfer {
  readonly id?: number;
  readonly username: Username;
  readonly label: Label;
  readonly source: LocalPath;
  readonly state: TransferState;
  readonly attempts: number;
  readonly lastError?: string;
  readonly queuedAt: string;
  readonly updatedAt: string;

  private constructor(props: SyncTransferProps) {
    if (props.id !== undefined) {
      this.id = props.id;
    }
    this.username = props.username;
    this.label = props.label;
    this.source = props.source;
    this.state = props.state;
    this.attempts = props.attempts;
    if (props.lastError !== undefined) {
      this.lastError = props.lastError;
    }
    this.queuedAt = props.queuedAt;
    this.updatedAt = props.updatedAt;
  }

  static queue(props: {
    username: Username;
    label: Label;
    source: LocalPath;
    queuedAt: string;
  }): SyncTransfer {
    return new SyncTransfer({
      ...props,
      state: 'waiting',
      attempts: 0,
      updatedAt: props.queuedAt,
    });
  }

  static restore(props: SyncTransferProps): SyncTransfer {
    return new SyncTransfer(props);
  }

  get name(): string {
    return this.source.name;
  }

  start(at: string): SyncTransfer {
    if (this.state === 'sending') {
      throw new TransferAlreadyOnItsWayError();
    }
    // the attempt is counted when it STARTS, not when it ends: a pass that dies
    // mid-transfer must still leave a trace that it tried
    return this.next({ state: 'sending', attempts: this.attempts + 1, updatedAt: at });
  }

  succeed(at: string): SyncTransfer {
    return this.next({ state: 'sent', updatedAt: at });
  }

  fail(reason: string, at: string): SyncTransfer {
    return this.next({ state: 'failed', lastError: reason, updatedAt: at });
  }

  requeue(at: string): SyncTransfer {
    if (this.state === 'sent') {
      throw new TransferNotRetryableError(this.state);
    }
    // the attempt count is kept: it is the history, not the state
    return this.next({ state: 'waiting', updatedAt: at });
  }

  private next(changes: Partial<SyncTransferProps>): SyncTransfer {
    const base: SyncTransferProps = {
      ...(this.id !== undefined && { id: this.id }),
      username: this.username,
      label: this.label,
      source: this.source,
      state: this.state,
      attempts: this.attempts,
      queuedAt: this.queuedAt,
      updatedAt: this.updatedAt,
      // lastError is deliberately NOT carried over: every transition states its
      // own outcome, so a stale reason cannot outlive the failure it described
      ...changes,
    };
    return new SyncTransfer(base);
  }
}
