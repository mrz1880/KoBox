import { DomainError } from '../shared/DomainError.js';

export class InvalidSyncModeError extends DomainError {
  constructor(raw: string) {
    super(`invalid sync mode ${JSON.stringify(raw)}`);
  }
}

export type SyncModeValue = 'off' | 'scheduled' | 'immediate';

// What a category does with a download once it has finished. The legacy stored
// 0/1/2 in a column and decoded them in bash; naming the three states is the
// whole difference between a screen a member understands and one they guess at.
export class SyncMode {
  // nothing leaves the box for this category
  static readonly off = new SyncMode('off');
  // it goes out on the next scheduled pass — kinder to a busy link
  static readonly scheduled = new SyncMode('scheduled');
  // it goes out the moment the download finishes
  static readonly immediate = new SyncMode('immediate');

  private constructor(readonly value: SyncModeValue) {}

  static all(): readonly SyncMode[] {
    return [SyncMode.off, SyncMode.scheduled, SyncMode.immediate];
  }

  static parse(raw: string): SyncMode {
    const found = SyncMode.all().find((mode) => mode.value === raw);
    if (found === undefined) {
      throw new InvalidSyncModeError(raw);
    }
    return found;
  }

  get sends(): boolean {
    return this !== SyncMode.off;
  }

  get isImmediate(): boolean {
    return this === SyncMode.immediate;
  }

  equals(other: SyncMode): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
