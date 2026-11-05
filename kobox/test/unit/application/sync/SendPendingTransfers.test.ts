import { describe, expect, it } from 'vitest';
import { WallClockHour } from '../../../../src/domain/sync/WallClockHour.js';
import { TransferFailure } from '../../../../src/domain/sync/TransferFailure.js';
import { SendPendingTransfers } from '../../../../src/application/sync/SendPendingTransfers.js';
import { SCHEDULED_PASS } from '../../../../src/domain/sync/SendPass.js';
import { HostKeyFingerprint } from '../../../../src/domain/sync/HostKeyFingerprint.js';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePassword } from '../../../../src/domain/sync/RemotePassword.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { SendHour } from '../../../../src/domain/sync/SendHour.js';
import { SyncDestination } from '../../../../src/domain/sync/SyncDestination.js';
import { SyncTransfer } from '../../../../src/domain/sync/SyncTransfer.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import type { TransferOutcome } from '../../../../src/domain/sync/ports.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { InMemoryMailOutbox } from '../../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryPortalCredentialsRepository } from '../../../../src/infrastructure/persistence/InMemoryPortalCredentialsRepository.js';
import { InMemorySyncDestinationRepository } from '../../../../src/infrastructure/persistence/InMemorySyncDestinationRepository.js';
import { InMemorySyncTransferRepository } from '../../../../src/infrastructure/persistence/InMemorySyncTransferRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

const NOW = '2026-08-15 10:00:00';
const alice = Username.parse('alice');

// `language` is the member's own choice; absent, they never made one
async function world(outcome: TransferOutcome, language?: Language) {
  const users = new InMemoryUserRepository();
  await users.save(new UserBuilder().build());
  const credentials = new InMemoryPortalCredentialsRepository();
  await credentials.save(
    { username: alice, role: 'user', ...(language !== undefined && { language }) },
    NOW,
  );
  const destinations = new InMemorySyncDestinationRepository();
  await destinations.save(
    SyncDestination.define({
      username: alice,
      host: RemoteHost.parse('nas.example.org'),
      port: RemotePort.parse(22),
      account: RemoteAccount.parse('seedbox'),
      sealedPassword: 'sealed',
      path: RemotePath.parse('/volume1/torrents'),
      batchSize: TransferBatchSize.unlimited(),
      placement: LoneFilePlacement.besideTheOthers,
      sendHour: SendHour.parse(2),
    }).withTransferMails('every'),
  );
  const transfers = new InMemorySyncTransferRepository();
  const outbox = new InMemoryMailOutbox();
  const opened: string[] = [];
  const useCase = new SendPendingTransfers({
    users,
    credentials,
    destinations,
    transfers,
    // these passes are scheduled: what each folder does is not read
    instances: new InMemoryTorrentInstanceRepository(),
    outbox,
    opener: {
      open: (sealed) => {
        opened.push(sealed);
        return Promise.resolve(RemotePassword.parse('opened'));
      },
    },
    transport: { send: () => Promise.resolve(outcome) },
    facts: { isDirectory: () => Promise.resolve(false), exists: () => Promise.resolve(true) },
    clock: () => NOW,
    wallClock: () => WallClockHour.parse('2026-08-15 02'),
  });
  return { destinations, transfers, outbox, opened, useCase };
}

async function queueEpisode(transfers: InMemorySyncTransferRepository): Promise<void> {
  await transfers.queue(
    SyncTransfer.queue({
      username: alice,
      label: Label.parse('Series'),
      source: LocalPath.parse('/home/alice/rtorrent/complete/Series/Some.Episode.mkv'),
      queuedAt: NOW,
    }),
  );
}

describe('SendPendingTransfers mails', () => {
  it('should_tell_a_member_who_never_chose_a_language_in_french', async () => {
    const { transfers, outbox, useCase } = await world({ ok: true });
    await queueEpisode(transfers);

    await useCase.execute(SCHEDULED_PASS);

    const [mail] = await outbox.listDue(NOW, 10);
    expect(mail?.subject).toBe('Some.Episode.mkv est arrivé');
    expect(mail?.body).toBe(
      'Some.Episode.mkv, de ton dossier Series, est arrivé sur ta machine.\n',
    );
  });

  it('should_tell_a_member_who_never_chose_a_language_in_french_why_a_file_did_not_arrive', async () => {
    const { transfers, outbox, useCase } = await world({
      ok: false,
      failure: TransferFailure.explained('no-room'),
    });
    await queueEpisode(transfers);

    await useCase.execute(SCHEDULED_PASS);

    const [mail] = await outbox.listDue(NOW, 10);
    expect(mail?.subject).toBe('Some.Episode.mkv n’est pas arrivé');
    expect(mail?.body).toBe(
      [
        'Some.Episode.mkv, de ton dossier Series, n’a pas pu être envoyé sur ta machine :',
        'l’autre machine n’a plus de place.',
        '',
        'Il reste dans Dossiers sur ta seedbox, d’où tu peux le réessayer.',
        '',
      ].join('\n'),
    );
  });

  // rsync's own words have no translation: they follow a sentence that does
  it('should_lead_what_rsync_said_with_a_sentence_in_the_members_language', async () => {
    const { transfers, outbox, useCase } = await world({
      ok: false,
      failure: TransferFailure.reported('rsync: [sender] write error: Broken pipe (32)'),
    });
    await queueEpisode(transfers);

    await useCase.execute(SCHEDULED_PASS);

    expect((await outbox.listDue(NOW, 10))[0]?.body).toContain(
      '\nrsync s’est arrêté sur une erreur que KoBox ne sait pas expliquer : rsync: [sender] write error: Broken pipe (32).\n',
    );
  });

  it('should_tell_the_member_which_folder_the_arrived_file_came_from', async () => {
    const { transfers, outbox, useCase } = await world({ ok: true }, Language.en);
    await queueEpisode(transfers);

    await useCase.execute(SCHEDULED_PASS);

    const [mail] = await outbox.listDue(NOW, 10);
    expect(mail?.body).toBe(
      'Some.Episode.mkv, from your Series folder, has arrived on your own machine.\n',
    );
  });

  it('should_tell_the_member_why_the_file_did_not_arrive_and_where_it_still_is', async () => {
    const { transfers, outbox, useCase } = await world({
      ok: false,
      failure: TransferFailure.explained('no-room'),
    }, Language.en);
    await queueEpisode(transfers);

    await useCase.execute(SCHEDULED_PASS);

    const [mail] = await outbox.listDue(NOW, 10);
    expect(mail?.body).toBe(
      [
        'Some.Episode.mkv, from your Series folder, could not be sent to your own machine:',
        'the other machine has no room left.',
        '',
        'It stays under Folders on your seedbox, where you can try it again.',
        '',
      ].join('\n'),
    );
  });

  it('should_still_give_a_reason_when_the_transport_gave_none', async () => {
    const { transfers, outbox, useCase } = await world({ ok: false }, Language.en);
    await queueEpisode(transfers);

    await useCase.execute(SCHEDULED_PASS);

    expect((await transfers.listRecent(alice, 10))[0]?.failure).toEqual(
      TransferFailure.explained('unexplained'),
    );
    expect((await outbox.listDue(NOW, 10))[0]?.body).toContain('\nit did not go through.\n');
  });
});

describe('SendPendingTransfers with nothing waiting', () => {
  it('should_not_open_the_sealed_password', async () => {
    // the root worker opens a member's secret only when it has something to send
    const { opened, useCase } = await world({ ok: true });

    await useCase.execute(SCHEDULED_PASS);

    expect(opened).toEqual([]);
  });
});

// seen on 2026-11-05: a member who never tested the connection had nothing
// recorded of their machine; the first transfer is that first contact
describe('SendPendingTransfers on a contact with the machine', () => {
  it('should_record_the_identity_the_machine_presented', async () => {
    const identity = HostKeyFingerprint.parse('SHA256:abc');
    const { destinations, transfers, useCase } = await world({ ok: true, identity });
    await queueEpisode(transfers);

    await useCase.execute(SCHEDULED_PASS);

    expect((await destinations.findByUsername(alice))?.identity).toEqual(identity);
  });
});
