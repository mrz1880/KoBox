import { describe, expect, it } from 'vitest';
import { IpAddress } from '../../../src/domain/shared/IpAddress.js';
import { TrackerHost } from '../../../src/domain/tracker/TrackerHost.js';
import { TrackerPort } from '../../../src/domain/tracker/TrackerPort.js';
import { FakeBlocklistDownload } from '../../../src/infrastructure/system/fakes/FakeBlocklistDownload.js';
import { FakeCertStore } from '../../../src/infrastructure/system/fakes/FakeCertStore.js';
import { FakeDnsResolver } from '../../../src/infrastructure/system/fakes/FakeDnsResolver.js';
import { FakeIblocklistCatalog } from '../../../src/infrastructure/system/fakes/FakeIblocklistCatalog.js';
import { FakeNetworkServiceReload } from '../../../src/infrastructure/system/fakes/FakeNetworkServiceReload.js';
import { FakeNotifications } from '../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeTrackerCert } from '../../../src/infrastructure/system/fakes/FakeTrackerCert.js';

const host = TrackerHost.parse('tracker.example.org');

describe('FakeTrackerCert', () => {
  it('should_serve_preloaded_certs_and_undefined_otherwise', async () => {
    const fake = new FakeTrackerCert();
    fake.givenCert('tracker.example.org', { pem: 'PEM', expiresOn: '2026-09-15' });
    expect(await fake.fetch(host, TrackerPort.parse(443))).toEqual({
      pem: 'PEM',
      expiresOn: '2026-09-15',
    });
    expect(await fake.fetch(TrackerHost.parse('other.example.net'), TrackerPort.parse(443)))
      .toBeUndefined();
  });
});

describe('FakeCertStore', () => {
  it('should_track_installed_pems_and_rehash_calls', async () => {
    const fake = new FakeCertStore();
    await fake.install(host, 'PEM');
    expect(fake.installed.get('tracker.example.org')).toBe('PEM');
    await fake.rehash();
    expect(fake.rehashCount).toBe(1);
    await fake.remove(host);
    expect(fake.installed.has('tracker.example.org')).toBe(false);
  });
});

describe('FakeDnsResolver', () => {
  it('should_resolve_preloaded_hosts_and_empty_otherwise', async () => {
    const fake = new FakeDnsResolver();
    fake.givenAddresses('tracker.example.org', [IpAddress.parse('192.0.2.10')]);
    expect((await fake.resolveA(host)).map((ip) => ip.value)).toEqual(['192.0.2.10']);
    expect(await fake.resolveA(TrackerHost.parse('gone.example.net'))).toEqual([]);
  });
});

describe('FakeBlocklistDownload', () => {
  it('should_serve_preloaded_lists_by_url', async () => {
    const fake = new FakeBlocklistDownload();
    fake.givenList('https://list.example.org/a', { ranges: ['10.0.0.0/8'], sha256: 'aa' });
    expect(await fake.fetch('https://list.example.org/a')).toEqual({
      ranges: ['10.0.0.0/8'],
      sha256: 'aa',
    });
    expect(await fake.fetch('https://list.example.org/other')).toBeUndefined();
    expect(fake.requestedUrls).toEqual([
      'https://list.example.org/a',
      'https://list.example.org/other',
    ]);
  });
});

describe('FakeIblocklistCatalog', () => {
  it('should_serve_the_configured_catalog', async () => {
    const fake = new FakeIblocklistCatalog([
      { name: 'level1', author: 'a', listId: 'id', url: 'https://x', subscription: false },
    ]);
    expect(await fake.fetchCatalog()).toHaveLength(1);
  });
});

describe('FakeNetworkServiceReload', () => {
  it('should_record_reload_calls', async () => {
    const fake = new FakeNetworkServiceReload();
    await fake.reloadDns();
    expect(fake.dnsReloads).toBe(1);
  });
});

describe('FakeNotifications', () => {
  it('should_record_tracker_events_alongside_user_events', async () => {
    const fake = new FakeNotifications();
    await fake.notify({ type: 'UserCreated', username: 'alice' });
    await fake.notify({ type: 'TrackerDied', host: 'tracker.example.org' });
    await fake.notify({ type: 'BlocklistUpdateFailed', author: 'a', name: 'level1' });
    expect(fake.published.map((event) => event.type)).toEqual([
      'UserCreated',
      'TrackerDied',
      'BlocklistUpdateFailed',
    ]);
  });
});
