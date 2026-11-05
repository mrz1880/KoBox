import { describe, expect, it } from 'vitest';
import { Language } from '../../../../src/domain/portal/Language.js';
import { HostKeyFingerprint } from '../../../../src/domain/sync/HostKeyFingerprint.js';
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

function aDestination(): SyncDestination {
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
  });
}

function checkedWith(detail: string): SyncDestination {
  const destination = aDestination();
  return destination.recordCheck({ ok: false, at: '2026-11-04 10:00:00', detail }, destination);
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

  // a working check put back what failed for want of it: the member is told
  // their files are on their way again, without trying each one
  it('should_tell_how_many_failed_transfers_a_working_check_put_back', () => {
    const destination = aDestination();
    const putBack = (requeued: number) =>
      destinationSection(
        destination.recordCheck({ ok: true, at: '2026-11-05 10:00:00', requeued }, destination),
        frenchMember,
      ).value;

    expect(putBack(1)).toContain('Un transfert qui avait échoué est de nouveau dans la file.');
    expect(putBack(3)).toContain('3 transferts qui avaient échoué sont de nouveau dans la file.');
  });

  // a transfer to a machine never tested is its first contact: the page shows
  // what it presented itself as, though no check ran
  it('should_show_the_identity_a_transfer_recorded_before_any_check', () => {
    const destination = aDestination();
    const known = destination.recognise(HostKeyFingerprint.parse('SHA256:abc'), destination);

    expect(destinationSection(known, frenchMember).value).toContain('SHA256:abc');
  });

  // the sentence a refused transfer shows sends the member here
  it('should_say_testing_is_how_a_reinstalled_machine_is_trusted_again', () => {
    expect(destinationSection(aDestination(), frenchMember).value).toContain(
      'Si vous avez réinstallé votre machine, c’est aussi ce qui fait accepter sa nouvelle identité à KoBox.',
    );
  });
});
