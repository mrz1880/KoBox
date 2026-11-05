// Why a transfer did not arrive, in a sentence a member can act on. Each one is
// also how the failure is recorded: a transfer's stored reason is this
// sentence, word for word, so it is never reworded without keeping the old
// wording readable (see fromRecord).
export const TRANSFER_FAILURE_REASONS = {
  refused: 'the machine refused the account, the password, or that folder',
  'identity-changed':
    'the machine presented another identity than the one recorded for it, so nothing was sent: if you reinstalled it, test the connection again to accept its new identity, otherwise stop and check why',
  'no-room': 'the other machine has no room left',
  dropped: 'the connection dropped part way through: it will resume where it stopped',
  'no-answer': 'the machine did not answer',
  'source-gone': 'the file is no longer on the box',
  unexplained: 'it did not go through',
} as const;

// A failure KoBox recognised and explains in its own words
export type ExplainedFailure = keyof typeof TRANSFER_FAILURE_REASONS;

// What is known about a failure: one KoBox explains, rsync stopping without a
// word, or rsync's own words that KoBox does not recognise
export type FailureCause =
  | { readonly kind: 'explained'; readonly reason: ExplainedFailure }
  | { readonly kind: 'stopped'; readonly exitCode: number }
  | { readonly kind: 'reported'; readonly line: string };

const STOPPED_PREFIX = 'rsync stopped with code ';
const STOPPED_RECORD = /^rsync stopped with code (\d+)$/;

function isExplained(reason: string): reason is ExplainedFailure {
  return Object.hasOwn(TRANSFER_FAILURE_REASONS, reason);
}

const EXPLAINED_BY_RECORD: ReadonlyMap<string, ExplainedFailure> = new Map(
  Object.entries(TRANSFER_FAILURE_REASONS).flatMap(([reason, sentence]) =>
    isExplained(reason) ? [[sentence, reason] as const] : [],
  ),
);

/**
 * Why one transfer did not arrive. Immutable, compared by value.
 */
export class TransferFailure {
  private constructor(readonly cause: FailureCause) {}

  /**
   * @param reason a failure KoBox recognised
   * @returns that failure, explained in KoBox's words
   */
  static explained(reason: ExplainedFailure): TransferFailure {
    return new TransferFailure({ kind: 'explained', reason });
  }

  /**
   * @param exitCode rsync's exit status, when it said nothing else
   * @returns the failure, known by that status alone
   */
  static stopped(exitCode: number): TransferFailure {
    return new TransferFailure({ kind: 'stopped', exitCode });
  }

  /**
   * @param line what rsync or ssh said, in their own words
   * @returns the failure, known by those words alone
   */
  static reported(line: string): TransferFailure {
    return new TransferFailure({ kind: 'reported', line });
  }

  /**
   * Reads back a failure as it was recorded.
   *
   * @param record the stored reason of a transfer
   * @returns the failure that record describes; words KoBox does not
   * recognise are rsync's own
   */
  static fromRecord(record: string): TransferFailure {
    const explained = EXPLAINED_BY_RECORD.get(record);
    if (explained !== undefined) {
      return TransferFailure.explained(explained);
    }
    const stopped = STOPPED_RECORD.exec(record);
    if (stopped?.[1] !== undefined) {
      return TransferFailure.stopped(Number(stopped[1]));
    }
    return TransferFailure.reported(record);
  }

  /** How the failure is recorded, read back by fromRecord. */
  get record(): string {
    switch (this.cause.kind) {
      case 'explained':
        return TRANSFER_FAILURE_REASONS[this.cause.reason];
      case 'stopped':
        return `${STOPPED_PREFIX}${String(this.cause.exitCode)}`;
      case 'reported':
        return this.cause.line;
    }
  }

  equals(other: TransferFailure): boolean {
    return this.record === other.record;
  }
}
