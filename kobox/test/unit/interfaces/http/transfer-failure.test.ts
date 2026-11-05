import { describe, expect, it } from 'vitest';
import { TRANSFER_FAILURE_REASONS, TransferFailure } from '../../../../src/domain/sync/TransferFailure.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { SyncTransfer } from '../../../../src/domain/sync/SyncTransfer.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { Username } from '../../../../src/domain/user/Username.js';
import type { Viewer } from '../../../../src/interfaces/http/views/layout.js';
import { hasFrench, translatorFor } from '../../../../src/interfaces/http/views/messages.js';
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

  // the page passes the recorded reason to the catalogue as it is: a reason
  // with no French line would reach a French member in English, silently
  it('should_have_a_french_line_for_every_reason_a_transfer_can_record', () => {
    const reasons = Object.values(TRANSFER_FAILURE_REASONS);

    expect(reasons.filter((reason) => !hasFrench(reason))).toEqual([]);
  });
});
