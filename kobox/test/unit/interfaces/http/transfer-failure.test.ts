import { describe, expect, it } from 'vitest';
import { TRANSFER_FAILURE_REASONS, TransferFailure } from '../../../../src/domain/sync/TransferFailure.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { SyncTransfer } from '../../../../src/domain/sync/SyncTransfer.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { Username } from '../../../../src/domain/user/Username.js';
import type { Viewer } from '../../../../src/interfaces/http/views/layout.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';
import { transferQueueSection } from '../../../../src/interfaces/http/views/transferQueueSection.js';

const frenchMember: Viewer = {
  language: Language.fr,
  t: translatorFor(Language.fr),
  zone: 'Europe/Paris',
  username: 'alice',
  role: 'user',
  csrfToken: 'csrf',
};

function failedWith(failure: TransferFailure): SyncTransfer {
  return SyncTransfer.restore({
    id: 1,
    username: Username.parse('alice'),
    label: Label.parse('films'),
    source: LocalPath.parse('/home/alice/rtorrent/complete/films/Some.Film.mkv'),
    state: 'failed',
    attempts: 1,
    failure,
    queuedAt: '2026-11-04 10:00:00',
    updatedAt: '2026-11-04 10:05:00',
  });
}

describe('why a transfer did not arrive', () => {
  // the reason is what a member reads to know what to fix on their own machine
  it('should_tell_a_french_member_in_french', () => {
    const section = transferQueueSection(
      [failedWith(TransferFailure.explained('no-room'))],
      frenchMember,
    ).value;

    expect(section).toContain('l’autre machine n’a plus de place');
  });

  it('should_tell_a_french_member_that_rsync_stopped_and_with_which_code', () => {
    const section = transferQueueSection([failedWith(TransferFailure.stopped(12))], frenchMember).value;

    expect(section).toContain('rsync s’est arrêté avec le code 12');
  });

  // rsync's own words have no translation: a French sentence says what
  // happened, and the words follow as they came, for whoever helps the member
  it('should_lead_what_rsync_said_with_a_french_sentence_and_keep_its_words', () => {
    const section = transferQueueSection(
      [failedWith(TransferFailure.reported('rsync: [sender] write error: Broken pipe (32)'))],
      frenchMember,
    ).value;

    expect(section).toContain('rsync s’est arrêté sur une erreur que KoBox ne sait pas expliquer');
    expect(section).toContain('<span class="mono">rsync: [sender] write error: Broken pipe (32)</span>');
  });

  it('should_tell_an_english_member_in_english', () => {
    const section = transferQueueSection([failedWith(TransferFailure.explained('no-room'))], {
      ...frenchMember,
      language: Language.en,
    }).value;

    expect(section).toContain(TRANSFER_FAILURE_REASONS['no-room']);
  });
});
