import { describe, expect, it } from 'vitest';
import { SendPendingTransfers } from '../../../../src/application/sync/SendPendingTransfers.js';
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
import { InMemoryMailOutbox } from '../../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemorySyncDestinationRepository } from '../../../../src/infrastructure/persistence/InMemorySyncDestinationRepository.js';
import { InMemorySyncTransferRepository } from '../../../../src/infrastructure/persistence/InMemorySyncTransferRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

const NOW = '2026-08-15 10:00:00';
const alice = Username.parse('alice');

async function world(outcome: TransferOutcome) {
  const users = new InMemoryUserRepository();
  await users.save(new UserBuilder().build());
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
    destinations,
    transfers,
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
    hour: () => 2,
  });
  return { transfers, outbox, opened, useCase };
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
  it('should_tell_the_member_which_folder_the_arrived_file_came_from', async () => {
    const { transfers, outbox, useCase } = await world({ ok: true });
    await queueEpisode(transfers);

    await useCase.execute();

    const [mail] = await outbox.listDue(NOW, 10);
    expect(mail?.body).toBe(
      'Some.Episode.mkv, from your Series folder, has arrived on your own machine.\n',
    );
  });

  it('should_tell_the_member_why_the_file_did_not_arrive_and_where_it_still_is', async () => {
    const { transfers, outbox, useCase } = await world({ ok: false, detail: 'no room left' });
    await queueEpisode(transfers);

    await useCase.execute();

    const [mail] = await outbox.listDue(NOW, 10);
    expect(mail?.body).toBe(
      [
        'Some.Episode.mkv, from your Series folder, could not be sent to your own machine:',
        'no room left.',
        '',
        'It stays under Folders on your seedbox, where you can try it again.',
        '',
      ].join('\n'),
    );
  });

  it('should_still_give_a_reason_when_the_transport_gave_none', async () => {
    const { transfers, outbox, useCase } = await world({ ok: false });
    await queueEpisode(transfers);

    await useCase.execute();

    expect((await transfers.listRecent(alice, 10))[0]?.lastError).toBe('it did not go through');
    expect((await outbox.listDue(NOW, 10))[0]?.body).toContain('\nit did not go through.\n');
  });
});

describe('SendPendingTransfers with nothing waiting', () => {
  it('should_not_open_the_sealed_password', async () => {
    // the root worker opens a member's secret only when it has something to send
    const { opened, useCase } = await world({ ok: true });

    await useCase.execute();

    expect(opened).toEqual([]);
  });
});
