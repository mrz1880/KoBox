import { describe, expect, it } from 'vitest';
import { QueueFinishedDownload } from '../../../../src/application/sync/QueueFinishedDownload.js';
import { RequeueTransfer } from '../../../../src/application/sync/RequeueTransfer.js';
import { SendPendingTransfers } from '../../../../src/application/sync/SendPendingTransfers.js';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { SyncTransfer } from '../../../../src/domain/sync/SyncTransfer.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePassword } from '../../../../src/domain/sync/RemotePassword.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { SendHour } from '../../../../src/domain/sync/SendHour.js';
import { SyncDestination } from '../../../../src/domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import type {
  FileTransferPort,
  LocalFileFactsPort,
  TransferOutcome,
} from '../../../../src/domain/sync/ports.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { SyncMode } from '../../../../src/domain/torrent/SyncMode.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { InMemorySyncDestinationRepository } from '../../../../src/infrastructure/persistence/InMemorySyncDestinationRepository.js';
import { InMemorySyncTransferRepository } from '../../../../src/infrastructure/persistence/InMemorySyncTransferRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { UserBuilder } from '../../../builders/UserBuilder.js';

const NOW = '2026-08-15 10:00:00';
const alice = Username.parse('alice');
const films = Label.parse('Films');
const SOURCE = '/home/alice/rtorrent/complete/Films/Some.Film.2024.mkv';

async function instancesWith(mode: SyncMode): Promise<InMemoryTorrentInstanceRepository> {
  const instances = new InMemoryTorrentInstanceRepository();
  const provisioned = TorrentInstance.provision({
    username: alice,
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45000),
  }).instance;
  await instances.save(provisioned.addWatchDir(films).instance.setSyncMode(films, mode));
  return instances;
}

function aDestination(overrides: Partial<{ batchSize: TransferBatchSize; hour: SendHour }> = {}) {
  return SyncDestination.define({
    username: alice,
    host: RemoteHost.parse('nas.example.org'),
    port: RemotePort.parse(22),
    account: RemoteAccount.parse('seedbox'),
    sealedPassword: 'sealed',
    path: RemotePath.parse('/volume1/torrents'),
    batchSize: overrides.batchSize ?? TransferBatchSize.unlimited(),
    placement: LoneFilePlacement.besideTheOthers,
    sendHour: overrides.hour ?? SendHour.parse(2),
  });
}

class RecordingTransport implements FileTransferPort {
  readonly sent: { source: string; remoteFolder: string }[] = [];

  constructor(private readonly outcome: TransferOutcome = { ok: true }) {}

  send(request: { source: LocalPath; remoteFolder: string }): Promise<TransferOutcome> {
    this.sent.push({ source: request.source.value, remoteFolder: request.remoteFolder });
    return Promise.resolve(this.outcome);
  }
}

const everythingIsAFile: LocalFileFactsPort = {
  isDirectory: () => Promise.resolve(false),
  exists: () => Promise.resolve(true),
};

describe('QueueFinishedDownload', () => {
  async function queueWith(mode: SyncMode, source = SOURCE) {
    const transfers = new InMemorySyncTransferRepository();
    const useCase = new QueueFinishedDownload({
      instances: await instancesWith(mode),
      transfers,
      clock: () => NOW,
    });
    const verdict = await useCase.execute({ username: alice, label: films, source });
    return { verdict, transfers, useCase };
  }

  it('should_queue_nothing_for_a_folder_the_member_keeps_here', async () => {
    const { verdict, transfers } = await queueWith(SyncMode.off);

    expect(verdict.queued).toBe(false);
    expect(await transfers.countByState(alice, 'waiting')).toBe(0);
  });

  it('should_queue_it_for_the_next_pass_when_that_is_what_was_asked', async () => {
    const { verdict, transfers } = await queueWith(SyncMode.scheduled);

    expect(verdict).toEqual({ queued: true, sendNow: false });
    expect(await transfers.countByState(alice, 'waiting')).toBe(1);
  });

  it('should_ask_for_it_to_go_out_now_when_the_folder_says_straight_away', async () => {
    const { verdict } = await queueWith(SyncMode.immediate);

    expect(verdict).toEqual({ queued: true, sendNow: true });
  });

  it('should_ignore_a_path_outside_the_members_own_home', async () => {
    // the path comes from a shim a member controls and the ROOT worker reads it
    const { verdict, transfers } = await queueWith(SyncMode.immediate, '/home/boss/secrets/x.mkv');

    expect(verdict.queued).toBe(false);
    expect(await transfers.countByState(alice, 'waiting')).toBe(0);
  });

  it('should_queue_the_same_download_only_once', async () => {
    // rTorrent can fire `finished` more than once for one torrent, and the
    // legacy stacked a duplicate every time it did
    const { transfers, useCase } = await queueWith(SyncMode.scheduled);

    const second = await useCase.execute({ username: alice, label: films, source: SOURCE });

    expect(second.queued).toBe(false);
    expect(await transfers.countByState(alice, 'waiting')).toBe(1);
  });
});

describe('SendPendingTransfers', () => {
  async function world(options: { hour?: number; batchSize?: TransferBatchSize } = {}) {
    const users = new InMemoryUserRepository();
    await users.save(new UserBuilder().build());
    const destinations = new InMemorySyncDestinationRepository();
    await destinations.save(
      aDestination({
        ...(options.batchSize !== undefined && { batchSize: options.batchSize }),
      }),
    );
    const transfers = new InMemorySyncTransferRepository();
    const transport = new RecordingTransport();
    const useCase = new SendPendingTransfers({
      users,
      destinations,
      transfers,
      opener: { open: () => Promise.resolve(RemotePassword.parse('opened')) },
      transport,
      facts: everythingIsAFile,
      clock: () => NOW,
      hour: () => options.hour ?? 2,
    });
    return { transfers, transport, useCase };
  }

  async function queueOne(
    transfers: InMemorySyncTransferRepository,
    name: string,
  ): Promise<void> {
    await transfers.queue(
      SyncTransfer.queue({
        username: alice,
        label: films,
        source: LocalPath.parse(`/home/alice/rtorrent/complete/Films/${name}`),
        queuedAt: NOW,
      }),
    );
  }

  it('should_send_what_is_waiting_when_the_members_hour_has_come', async () => {
    const { transfers, transport, useCase } = await world({ hour: 2 });
    await queueOne(transfers, 'a.mkv');

    await useCase.execute();

    expect(transport.sent).toHaveLength(1);
    expect(await transfers.countByState(alice, 'sent')).toBe(1);
  });

  it('should_wait_for_their_hour_rather_than_sending_at_any_time', async () => {
    // a member on a slow link picked the middle of the night on purpose
    const { transfers, transport, useCase } = await world({ hour: 14 });
    await queueOne(transfers, 'a.mkv');

    await useCase.execute();

    expect(transport.sent).toHaveLength(0);
    expect(await transfers.countByState(alice, 'waiting')).toBe(1);
  });

  it('should_send_one_members_queue_straight_away_when_asked_whatever_the_hour', async () => {
    const { transfers, transport, useCase } = await world({ hour: 14 });
    await queueOne(transfers, 'a.mkv');

    await useCase.execute(alice);

    expect(transport.sent).toHaveLength(1);
  });

  it('should_take_on_no_more_than_the_member_allowed_in_one_pass', async () => {
    const { transfers, transport, useCase } = await world({
      hour: 2,
      batchSize: TransferBatchSize.parse(2),
    });
    for (const name of ['a.mkv', 'b.mkv', 'c.mkv']) {
      await queueOne(transfers, name);
    }

    await useCase.execute();

    expect(transport.sent).toHaveLength(2);
    expect(await transfers.countByState(alice, 'waiting')).toBe(1);
  });

  it('should_put_a_lone_file_in_its_own_folder_when_that_is_what_scrapers_need', async () => {
    const users = new InMemoryUserRepository();
    await users.save(new UserBuilder().build());
    const destinations = new InMemorySyncDestinationRepository();
    await destinations.save(aDestination().withPlacement(LoneFilePlacement.inItsOwnFolder));
    const transfers = new InMemorySyncTransferRepository();
    const transport = new RecordingTransport();
    await queueOne(transfers, 'Some.Film.2024.mkv');

    await new SendPendingTransfers({
      users,
      destinations,
      transfers,
      opener: { open: () => Promise.resolve(RemotePassword.parse('opened')) },
      transport,
      facts: everythingIsAFile,
      clock: () => NOW,
      hour: () => 2,
    }).execute();

    expect(transport.sent[0]?.remoteFolder).toBe('/volume1/torrents/Films/Some.Film.2024');
  });

  it('should_record_why_a_transfer_failed_instead_of_losing_it', async () => {
    const users = new InMemoryUserRepository();
    await users.save(new UserBuilder().build());
    const destinations = new InMemorySyncDestinationRepository();
    await destinations.save(aDestination());
    const transfers = new InMemorySyncTransferRepository();
    await queueOne(transfers, 'a.mkv');

    await new SendPendingTransfers({
      users,
      destinations,
      transfers,
      opener: { open: () => Promise.resolve(RemotePassword.parse('opened')) },
      transport: new RecordingTransport({ ok: false, detail: 'the other machine has no room left' }),
      facts: everythingIsAFile,
      clock: () => NOW,
      hour: () => 2,
    }).execute();

    const recent = await transfers.listRecent(alice, 10);
    expect(recent[0]?.state).toBe('failed');
    expect(recent[0]?.lastError).toBe('the other machine has no room left');
  });

  it('should_say_so_when_the_file_is_gone_rather_than_blaming_the_connection', async () => {
    const users = new InMemoryUserRepository();
    await users.save(new UserBuilder().build());
    const destinations = new InMemorySyncDestinationRepository();
    await destinations.save(aDestination());
    const transfers = new InMemorySyncTransferRepository();
    const transport = new RecordingTransport();
    await queueOne(transfers, 'a.mkv');

    await new SendPendingTransfers({
      users,
      destinations,
      transfers,
      opener: { open: () => Promise.resolve(RemotePassword.parse('opened')) },
      transport,
      facts: { isDirectory: () => Promise.resolve(false), exists: () => Promise.resolve(false) },
      clock: () => NOW,
      hour: () => 2,
    }).execute();

    const recent = await transfers.listRecent(alice, 10);
    expect(recent[0]?.lastError).toContain('no longer on the box');
    expect(transport.sent).toHaveLength(0);
  });
});

describe('RequeueTransfer', () => {
  async function aFailedTransfer(): Promise<{
    transfers: InMemorySyncTransferRepository;
    id: number;
  }> {
    const transfers = new InMemorySyncTransferRepository();
    const queued = await transfers.queue(
      SyncTransfer.queue({
        username: alice,
        label: films,
        source: LocalPath.parse(SOURCE),
        queuedAt: NOW,
      }),
    );
    if (queued?.id === undefined) {
      throw new Error('the fixture failed to queue a transfer');
    }
    await transfers.save(queued.start(NOW).fail('it did not go through', NOW));
    return { transfers, id: queued.id };
  }

  it('should_put_a_failed_transfer_back_in_the_queue', async () => {
    const { transfers, id } = await aFailedTransfer();

    await new RequeueTransfer({ transfers, clock: () => NOW }).execute(alice, id);

    expect(await transfers.countByState(alice, 'waiting')).toBe(1);
  });

  it('should_refuse_to_touch_another_members_transfer', async () => {
    const { transfers, id } = await aFailedTransfer();

    await new RequeueTransfer({ transfers, clock: () => NOW }).execute(Username.parse('boss'), id);

    expect(await transfers.countByState(alice, 'failed')).toBe(1);
  });
});
