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

// What a check that works proves: the machine answers and holds the line, it
// presents the identity KoBox trusts, it takes the account and the password,
// and the account can write in the folder. A transfer that failed on one of
// these goes through now. Room left over there, or a file gone from the box,
// is nothing a check looks at.
const FIXED_BY_A_WORKING_CONNECTION: Readonly<Record<ExplainedFailure, boolean>> = {
  refused: true,
  'identity-changed': true,
  'no-room': false,
  dropped: true,
  'no-answer': true,
  'source-gone': false,
  unexplained: false,
};

const STOPPED_PREFIX = 'rsync stopped with code ';
const STOPPED_RECORD = /^rsync stopped with code (\d+)$/;

function isExplained(reason: string): reason is ExplainedFailure {
  return Object.hasOwn(TRANSFER_FAILURE_REASONS, reason);
}

// Older rows hold the wording of the version that recorded them, the em dash
// spelled by its code point so this source holds none. Read back, each one is
// the failure it described: the page and the mails word it as of today, and a
// working check clears what it proves fixed.
const EM_DASH = String.fromCodePoint(0x2014);
const OLDER_WORDINGS: ReadonlyMap<string, ExplainedFailure> = new Map([
  // the wordings before v1.0.69
  [
    `the machine answered with a different identity than the one you tested ${EM_DASH} nothing was sent`,
    'identity-changed',
  ],
  [
    'the machine answered with a different identity than the one you tested: nothing was sent',
    'identity-changed',
  ],
  [`the connection dropped part way through ${EM_DASH} it will resume where it stopped`, 'dropped'],
]);

const EXPLAINED_BY_RECORD: ReadonlyMap<string, ExplainedFailure> = new Map([
  ...OLDER_WORDINGS,
  ...Object.entries(TRANSFER_FAILURE_REASONS).flatMap(([reason, sentence]) =>
    isExplained(reason) ? [[sentence, reason] as const] : [],
  ),
]);

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

  /**
   * Whether a check that found the connection working proves this failure
   * gone. rsync stopping on its own words or a bare code proves nothing
   * either way, so it stays failed.
   *
   * @returns true when the transfer would go through now
   */
  isFixedByAWorkingConnection(): boolean {
    return this.cause.kind === 'explained' && FIXED_BY_A_WORKING_CONNECTION[this.cause.reason];
  }

  equals(other: TransferFailure): boolean {
    return this.record === other.record;
  }
}
