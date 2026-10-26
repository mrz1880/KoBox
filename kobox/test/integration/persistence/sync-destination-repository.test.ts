import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoneFilePlacement } from '../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../src/domain/sync/RemoteHost.js';
import { RemotePath } from '../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../src/domain/sync/RemotePort.js';
import { SendHour } from '../../../src/domain/sync/SendHour.js';
import { SyncDestination } from '../../../src/domain/sync/SyncDestination.js';
import { TransferBatchSize } from '../../../src/domain/sync/TransferBatchSize.js';
import { Username } from '../../../src/domain/user/Username.js';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';
import { SqliteSyncDestinationRepository } from '../../../src/infrastructure/persistence/SqliteSyncDestinationRepository.js';

const alice = Username.parse('alice');

let dir: string;
let db: KoboxDatabase;
let repo: SqliteSyncDestinationRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-destinations-'));
  db = KoboxDatabase.open(join(dir, 'kobox.db'));
  repo = new SqliteSyncDestinationRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqliteSyncDestinationRepository', () => {
  it('should_keep_the_members_choice_of_transfer_mails', async () => {
    const destination = SyncDestination.define({
      username: alice,
      host: RemoteHost.parse('nas.example.org'),
      port: RemotePort.parse(22),
      account: RemoteAccount.parse('seedbox'),
      sealedPassword: 'sealed-blob',
      path: RemotePath.parse('/volume1/torrents'),
      batchSize: TransferBatchSize.unlimited(),
      placement: LoneFilePlacement.besideTheOthers,
      sendHour: SendHour.default(),
    });

    await repo.save(destination.withTransferMails('failures'));

    expect((await repo.findByUsername(alice))?.transferMails).toBe('failures');
  });
});
