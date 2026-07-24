import { describe, expect, it } from 'vitest';
import { IpAddress } from '../../../src/domain/shared/IpAddress.js';
import { Blocklist } from '../../../src/domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../../src/domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../../src/domain/tracker/BlocklistUrl.js';
import { CertExpiry } from '../../../src/domain/tracker/CertExpiry.js';
import { Tracker } from '../../../src/domain/tracker/Tracker.js';
import { TrackerHost } from '../../../src/domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../../src/domain/tracker/TrackerPort.js';
import { TrackerPrivacy } from '../../../src/domain/tracker/TrackerPrivacy.js';
import { TrackerProto } from '../../../src/domain/tracker/TrackerProto.js';
import { InMemoryBlocklistRepository } from '../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { InMemoryTrackerRepository } from '../../../src/infrastructure/persistence/InMemoryTrackerRepository.js';
import { InMemoryUserAddressRepository } from '../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { Username } from '../../../src/domain/user/Username.js';

function discoveredTracker(host = 'tracker.example.org'): Tracker {
  return Tracker.discover({
    host: TrackerHost.parse(host),
    proto: TrackerProto.parse('https'),
    port: TrackerPort.parse(443),
    privacy: TrackerPrivacy.parse('private'),
  }).tracker;
}

describe('InMemoryTrackerRepository', () => {
  it('should_honor_the_repository_contract', async () => {
    const repo = new InMemoryTrackerRepository();
    expect(await repo.findByHost(TrackerHost.parse('tracker.example.org'))).toBeUndefined();

    await repo.save(discoveredTracker());
    await repo.save(discoveredTracker()); // upsert by host
    const promoted = discoveredTracker('due.example.org').beginCheck().completeCheck({
      promoted: true,
      expiry: CertExpiry.on('2026-07-25'),
      at: '2026-07-01 10:00:00',
    });
    await repo.save(promoted);

    expect(await repo.listAll()).toHaveLength(2);
    expect(
      (await repo.findByHost(TrackerHost.parse('tracker.example.org')))?.checkState.value,
    ).toBe('pending');
    const needing = (await repo.listNeedingCertCheck('2026-07-24')).map((t) => t.host.value);
    expect(needing.sort()).toEqual(['due.example.org', 'tracker.example.org']);
  });
});

describe('InMemoryBlocklistRepository', () => {
  it('should_honor_the_repository_contract', async () => {
    const repo = new InMemoryBlocklistRepository();
    const list = Blocklist.create({
      source: BlocklistSource.parse('iblocklist'),
      author: 'Example Org',
      name: 'level1',
      url: BlocklistUrl.parse('https://list.example.org/?list=abc'),
      subscription: false,
      enabled: true,
    });
    await repo.save(list);
    await repo.save(list.disable()); // upsert by (source, author, name)

    expect(await repo.listAll()).toHaveLength(1);
    expect(await repo.listEnabled()).toHaveLength(0);
    const found = await repo.findBySourceAuthorName(
      BlocklistSource.parse('iblocklist'),
      'Example Org',
      'level1',
    );
    expect(found?.enabled).toBe(false);
  });
});

describe('InMemoryUserAddressRepository', () => {
  it('should_honor_the_repository_contract', async () => {
    const repo = new InMemoryUserAddressRepository();
    const alice = Username.parse('alice');
    await repo.add(alice, IpAddress.parse('198.51.100.7'));
    await repo.add(alice, IpAddress.parse('198.51.100.7'));
    expect(await repo.listAll()).toHaveLength(1);
    await repo.remove(alice, IpAddress.parse('198.51.100.7'));
    expect(await repo.listAll()).toHaveLength(0);
  });
});
