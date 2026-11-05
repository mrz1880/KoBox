import { describe, expect, it } from 'vitest';
import {
  TRANSFER_FAILURE_REASONS,
  TransferFailure,
  type ExplainedFailure,
} from '../../../../src/domain/sync/TransferFailure.js';

// spelled by its code point: the source itself holds no dash
const EM_DASH = String.fromCodePoint(0x2014);
const EXPLAINED = Object.keys(TRANSFER_FAILURE_REASONS) as ExplainedFailure[];

describe('TransferFailure', () => {
  // a failure is recorded as text: read back, it is the same failure
  it('should_read_back_every_failure_as_it_was_recorded', () => {
    const failures = [
      ...EXPLAINED.map((reason) => TransferFailure.explained(reason)),
      TransferFailure.stopped(12),
      TransferFailure.reported('rsync: [sender] write error: Broken pipe (32)'),
    ];

    const readBack = failures.map((failure) => TransferFailure.fromRecord(failure.record));

    expect(readBack).toEqual(failures);
  });

  it('should_record_an_explained_failure_as_its_sentence', () => {
    expect(TransferFailure.explained('no-room').record).toBe('the other machine has no room left');
  });

  it('should_take_words_it_does_not_recognise_for_what_rsync_said', () => {
    expect(TransferFailure.fromRecord('rsync error: some unknown thing').cause).toEqual({
      kind: 'reported',
      line: 'rsync error: some unknown thing',
    });
  });

  // rows recorded before a sentence was reworded keep the old wording: read
  // back, they are the same failure, so a working check clears them too
  it('should_read_an_older_wording_as_the_failure_it_described', () => {
    const older = [
      `the machine answered with a different identity than the one you tested ${EM_DASH} nothing was sent`,
      'the machine answered with a different identity than the one you tested: nothing was sent',
      `the connection dropped part way through ${EM_DASH} it will resume where it stopped`,
    ];

    expect(older.map((record) => TransferFailure.fromRecord(record))).toEqual([
      TransferFailure.explained('identity-changed'),
      TransferFailure.explained('identity-changed'),
      TransferFailure.explained('dropped'),
    ]);
  });

  // A check that works proves the machine answers, presents the identity
  // KoBox trusts, takes the account and password, and lets it write in the
  // folder: what failed for one of those goes through now. It proves nothing
  // about room left over there or a file gone from the box.
  it('should_be_fixed_by_a_working_connection_only_when_it_was_one_a_check_proves', () => {
    const fixed = EXPLAINED.filter((reason) =>
      TransferFailure.explained(reason).isFixedByAWorkingConnection(),
    );

    expect(fixed).toEqual(['refused', 'identity-changed', 'dropped', 'no-answer']);
    expect(TransferFailure.stopped(12).isFixedByAWorkingConnection()).toBe(false);
    expect(TransferFailure.reported('rsync: write error').isFixedByAWorkingConnection()).toBe(false);
  });

  // a member reads these sentences, in mails as on the page
  it('should_word_every_reason_without_a_dash', () => {
    expect(Object.values(TRANSFER_FAILURE_REASONS).filter((reason) => reason.includes(EM_DASH))).toEqual(
      [],
    );
  });
});
