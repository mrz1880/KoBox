import { describe, expect, it } from 'vitest';
import { Language } from '../../../../src/domain/portal/Language.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { SendHour } from '../../../../src/domain/sync/SendHour.js';
import { SyncDestination } from '../../../../src/domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { destinationSection } from '../../../../src/interfaces/http/views/destinationSection.js';
import type { Viewer } from '../../../../src/interfaces/http/views/layout.js';
import { translatorFor } from '../../../../src/interfaces/http/views/messages.js';

const frenchMember: Viewer = {
  language: Language.fr,
  t: translatorFor(Language.fr),
  zone: 'Europe/Paris',
  username: 'alice',
  role: 'user',
  csrfToken: 'csrf',
};

function checkedWith(detail: string): SyncDestination {
  return SyncDestination.define({
    username: Username.parse('alice'),
    host: RemoteHost.parse('nas.example.org'),
    port: RemotePort.parse(22),
    account: RemoteAccount.parse('seedbox'),
    sealedPassword: 'sealed',
    path: RemotePath.parse('/volume1/torrents'),
    batchSize: TransferBatchSize.unlimited(),
    placement: LoneFilePlacement.besideTheOthers,
    sendHour: SendHour.default(),
  }).recordCheck({ ok: false, at: '2026-11-04 10:00:00', detail });
}

describe('the verdict of the destination check', () => {
  // the check is what a member reads to know what to fix on their own machine
  it('should_tell_a_french_member_in_french_what_to_fix', () => {
    const section = (
      destinationSection(
        checkedWith('the account can sign in but cannot write in that folder'),
        frenchMember,
      )
    ).value;

    expect(section).toContain(
      'le compte peut se connecter mais ne peut pas écrire dans ce dossier',
    );
  });
});
