import { describe, expect, it } from 'vitest';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { SyncTransfer } from '../../../../src/domain/sync/SyncTransfer.js';
import { Username } from '../../../../src/domain/user/Username.js';

const alice = Username.parse('alice');
const films = Label.parse('Films');
const source = LocalPath.parse('/home/alice/rtorrent/complete/Films/Some.Film.2024.mkv');

function aTransfer(): SyncTransfer {
  return SyncTransfer.queue({
    username: alice,
    label: films,
    source,
    queuedAt: '2026-08-15 10:00:00',
  });
}

describe('SyncTransfer', () => {
  it('should_start_waiting_and_know_what_it_carries', () => {
    const transfer = aTransfer();

    expect(transfer.state).toBe('waiting');
    expect(transfer.attempts).toBe(0);
    // the name is what lands on the other machine, and what a member recognises
    expect(transfer.name).toBe('Some.Film.2024.mkv');
  });

  it('should_count_an_attempt_when_it_starts_sending', () => {
    const sending = aTransfer().start('2026-08-15 10:01:00');

    expect(sending.state).toBe('sending');
    expect(sending.attempts).toBe(1);
  });

  it('should_be_done_once_it_has_gone_through', () => {
    const sent = aTransfer().start('2026-08-15 10:01:00').succeed('2026-08-15 10:05:00');

    expect(sent.state).toBe('sent');
    expect(sent.lastError).toBeUndefined();
  });

  it('should_keep_why_it_failed_so_a_member_is_not_left_guessing', () => {
    const failed = aTransfer()
      .start('2026-08-15 10:01:00')
      .fail('the machine did not answer in time', '2026-08-15 10:02:00');

    expect(failed.state).toBe('failed');
    expect(failed.lastError).toBe('the machine did not answer in time');
  });

  it('should_go_back_to_waiting_when_a_member_puts_it_back_in_the_queue', () => {
    // the legacy had this control at the bottom of its screen, and it is the
    // difference between a failure you can fix and one you have to re-download
    const retried = aTransfer()
      .start('2026-08-15 10:01:00')
      .fail('nothing is listening on that port', '2026-08-15 10:02:00')
      .requeue('2026-08-15 11:00:00');

    expect(retried.state).toBe('waiting');
    // the attempt count is kept: it is the history, not the state
    expect(retried.attempts).toBe(1);
  });

  it('should_refuse_to_requeue_something_that_already_went_through', () => {
    const sent = aTransfer().start('2026-08-15 10:01:00').succeed('2026-08-15 10:05:00');

    expect(() => sent.requeue('2026-08-15 11:00:00')).toThrow();
  });

  it('should_refuse_to_start_something_that_is_already_on_its_way', () => {
    // two passes overlapping must not send the same file twice
    const sending = aTransfer().start('2026-08-15 10:01:00');

    expect(() => sending.start('2026-08-15 10:02:00')).toThrow();
  });
});
