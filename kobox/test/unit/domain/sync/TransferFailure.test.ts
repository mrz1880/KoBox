import { describe, expect, it } from 'vitest';
import {
  TRANSFER_FAILURE_REASONS,
  TransferFailure,
  type ExplainedFailure,
} from '../../../../src/domain/sync/TransferFailure.js';

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

  // a member reads these sentences, in mails as on the page
  it('should_word_every_reason_without_a_dash', () => {
    expect(Object.values(TRANSFER_FAILURE_REASONS).filter((reason) => reason.includes('—'))).toEqual([]);
  });
});
