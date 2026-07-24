import { beforeEach, describe, expect, it } from 'vitest';
import { ImportBlocklistCatalog } from '../../../../src/application/tracker/ImportBlocklistCatalog.js';
import { RenderBlocklistFilters } from '../../../../src/application/tracker/RenderBlocklistFilters.js';
import { UpdateBlocklists } from '../../../../src/application/tracker/UpdateBlocklists.js';
import { Blocklist } from '../../../../src/domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../../../src/domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../../../src/domain/tracker/BlocklistUrl.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryBlocklistRepository } from '../../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeBlocklistCache } from '../../../../src/infrastructure/system/fakes/FakeBlocklistCache.js';
import { FakeBlocklistDownload } from '../../../../src/infrastructure/system/fakes/FakeBlocklistDownload.js';
import { FakeIblocklistCatalog } from '../../../../src/infrastructure/system/fakes/FakeIblocklistCatalog.js';
import { FakeNotifications } from '../../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { aUser } from '../../../builders/UserBuilder.js';

const NOW = '2026-07-24 10:00:00';

let blocklists: InMemoryBlocklistRepository;
let download: FakeBlocklistDownload;
let notifications: FakeNotifications;
let cache: FakeBlocklistCache;
let files: FakeRtorrentConfig;
let users: InMemoryUserRepository;
let instances: InMemoryTorrentInstanceRepository;

beforeEach(() => {
  blocklists = new InMemoryBlocklistRepository();
  download = new FakeBlocklistDownload();
  notifications = new FakeNotifications();
  cache = new FakeBlocklistCache();
  files = new FakeRtorrentConfig();
  users = new InMemoryUserRepository();
  instances = new InMemoryTorrentInstanceRepository();
});

function personalList(name: string, url: string, enabled = true): Blocklist {
  return Blocklist.create({
    source: BlocklistSource.parse('personal'),
    author: 'me',
    name,
    url: BlocklistUrl.parse(url),
    subscription: false,
    enabled,
  });
}

describe('ImportBlocklistCatalog', () => {
  const catalog = new FakeIblocklistCatalog([
    { name: 'level1', author: 'Example Org', listId: 'aaa', url: 'https://l.example/aaa', subscription: false },
    { name: 'obscure', author: 'Example Org', listId: 'bbb', url: 'https://l.example/bbb', subscription: false },
    { name: 'paid', author: 'Example Org', listId: 'ccc', url: 'https://l.example/ccc', subscription: true },
    { name: 'P2P allow', author: 'Example Org', listId: 'ddd', url: 'https://l.example/ddd', subscription: false },
  ]);

  it('should_import_the_catalog_with_the_curated_enable_defaults', async () => {
    const report = await new ImportBlocklistCatalog({ catalog, blocklists }).execute();

    expect(report.imported).toBe(3); // P2P allow skipped (legacy rule)
    const all = await blocklists.listAll();
    const byName = new Map(all.map((list) => [list.name, list]));
    expect(byName.get('level1')?.enabled).toBe(true); // curated default
    expect(byName.get('obscure')?.enabled).toBe(false);
    expect(byName.get('paid')?.enabled).toBe(false); // subscription never auto-enabled
    expect(byName.get('P2P allow')).toBeUndefined();
  });

  it('should_keep_operator_toggles_on_reimport', async () => {
    const useCase = new ImportBlocklistCatalog({ catalog, blocklists });
    await useCase.execute();
    const level1 = await blocklists.findBySourceAuthorName(
      BlocklistSource.parse('iblocklist'),
      'Example Org',
      'level1',
    );
    await blocklists.save(level1?.disable() ?? personalList('x', 'https://x.example/x'));

    await useCase.execute(); // reimport must not re-enable

    const after = await blocklists.findBySourceAuthorName(
      BlocklistSource.parse('iblocklist'),
      'Example Org',
      'level1',
    );
    expect(after?.enabled).toBe(false);
  });
});

describe('UpdateBlocklists', () => {
  it('should_download_enabled_lists_merge_ranges_and_write_the_cache', async () => {
    await blocklists.save(personalList('a', 'https://lists.example.net/a.gz'));
    await blocklists.save(personalList('b', 'https://lists.example.net/b.gz'));
    await blocklists.save(personalList('off', 'https://lists.example.net/off.gz', false));
    download.givenList('https://lists.example.net/a.gz', {
      ranges: ['192.0.2.0-192.0.2.255'],
      sha256: 'aa',
    });
    download.givenList('https://lists.example.net/b.gz', {
      ranges: ['10.0.0.0/8', '192.0.2.0-192.0.2.255'],
      sha256: 'bb',
    });

    const report = await new UpdateBlocklists({
      blocklists,
      download,
      notifications,
      cache,
    }).execute({ now: NOW });

    expect(report.updated).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.ranges).toEqual(['10.0.0.0/8', '192.0.2.0-192.0.2.255']);
    expect(cache.stored).toEqual(['10.0.0.0/8', '192.0.2.0-192.0.2.255']);
    expect(download.requestedUrls).toHaveLength(2); // disabled list never fetched
    const updated = await blocklists.findBySourceAuthorName(
      BlocklistSource.parse('personal'),
      'me',
      'a',
    );
    expect(updated?.lastUpdate).toEqual({ status: 'ok', at: NOW });
    expect(updated?.sha256).toBe('aa');
  });

  it('should_isolate_a_failed_list_and_keep_updating_the_others', async () => {
    // issue #117: the expired subscription must not block the standard lists
    await blocklists.save(personalList('good', 'https://lists.example.net/good.gz'));
    await blocklists.save(personalList('expired', 'https://lists.example.net/expired.gz'));
    download.givenList('https://lists.example.net/good.gz', {
      ranges: ['10.0.0.0/8'],
      sha256: 'gg',
    });

    const report = await new UpdateBlocklists({
      blocklists,
      download,
      notifications,
      cache,
    }).execute({ now: NOW });

    expect(report.updated).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.ranges).toEqual(['10.0.0.0/8']);
    expect(notifications.published).toEqual([
      { type: 'BlocklistUpdateFailed', author: 'me', name: 'expired' },
    ]);
    const failed = await blocklists.findBySourceAuthorName(
      BlocklistSource.parse('personal'),
      'me',
      'expired',
    );
    expect(failed?.lastUpdate).toEqual({ status: 'failed' });
  });

  it('should_keep_the_previous_cache_when_every_download_fails', async () => {
    await cache.write(['203.0.113.0/24']);
    await blocklists.save(personalList('a', 'https://lists.example.net/a.gz'));

    const report = await new UpdateBlocklists({
      blocklists,
      download,
      notifications,
      cache,
    }).execute({ now: NOW });

    expect(report.ranges).toBeUndefined();
    expect(cache.stored).toEqual(['203.0.113.0/24']); // untouched
  });

  it('should_append_subscription_credentials_only_at_fetch_time', async () => {
    await blocklists.save(
      Blocklist.create({
        source: BlocklistSource.parse('iblocklist'),
        author: 'Example Org',
        name: 'paid',
        url: BlocklistUrl.parse('https://lists.example.net/paid'),
        subscription: true,
        enabled: true,
      }),
    );
    download.givenList('https://lists.example.net/paid?username=alice&pin=1234', {
      ranges: ['10.0.0.0/8'],
      sha256: 'pp',
    });

    const report = await new UpdateBlocklists({
      blocklists,
      download,
      notifications,
      cache,
      credentials: { username: 'alice', pin: '1234' },
    }).execute({ now: NOW });

    expect(report.updated).toBe(1);
    // the stored url stays credential-free
    const stored = await blocklists.findBySourceAuthorName(
      BlocklistSource.parse('iblocklist'),
      'Example Org',
      'paid',
    );
    expect(stored?.url.value).toBe('https://lists.example.net/paid');
  });
});

describe('RenderBlocklistFilters', () => {
  async function provisionAlice(): Promise<void> {
    await users.save(aUser().build());
    const { instance } = TorrentInstance.provision({
      username: Username.parse('alice'),
      scgiPort: ScgiPort.parse(51101),
      rtorrentPort: RtorrentPort.parse(45001),
    });
    await instances.save(instance);
  }

  it('should_render_the_filter_and_dropin_for_each_provisioned_user', async () => {
    await provisionAlice();
    await cache.write(['10.0.0.0/8']);

    const report = await new RenderBlocklistFilters({ users, instances, files, cache }).execute(
      {},
    );

    expect(report.changedFiles).toEqual([
      '/home/alice/blocklist/blocklist_rtorrent.txt',
      '/home/alice/rtorrent/config.d/80-blocklist.rc',
    ]);
    expect(files.contentAt('/home/alice/blocklist/blocklist_rtorrent.txt')).toBe('10.0.0.0/8\n');
    expect(files.contentAt('/home/alice/rtorrent/config.d/80-blocklist.rc')).toContain(
      'ipv4_filter.load',
    );
  });

  it('should_render_an_inert_dropin_when_the_cache_is_empty', async () => {
    await provisionAlice();

    await new RenderBlocklistFilters({ users, instances, files, cache }).execute({});

    expect(files.contentAt('/home/alice/rtorrent/config.d/80-blocklist.rc')).not.toContain(
      'ipv4_filter.load',
    );
  });

  it('should_skip_users_without_a_torrent_instance', async () => {
    await users.save(aUser().build()); // no instance provisioned
    await cache.write(['10.0.0.0/8']);

    const report = await new RenderBlocklistFilters({ users, instances, files, cache }).execute(
      {},
    );

    expect(report.changedFiles).toEqual([]);
  });

  it('should_target_a_single_user_when_asked', async () => {
    await provisionAlice();
    await users.save(aUser().withUsername('bob').withScgiPort(51102).withRtorrentPort(45002).build());
    await cache.write(['10.0.0.0/8']);

    const report = await new RenderBlocklistFilters({ users, instances, files, cache }).execute({
      username: Username.parse('alice'),
    });

    expect(report.changedFiles.every((path) => path.includes('/alice/'))).toBe(true);
  });
});
