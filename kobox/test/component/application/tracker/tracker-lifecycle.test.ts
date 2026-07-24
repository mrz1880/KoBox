import { beforeEach, describe, expect, it } from 'vitest';
import { DiscoverTrackerFromTorrent } from '../../../../src/application/tracker/DiscoverTrackerFromTorrent.js';
import { FetchTrackerCert } from '../../../../src/application/tracker/FetchTrackerCert.js';
import { ManageUserAddress } from '../../../../src/application/tracker/ManageUserAddress.js';
import { MarkTrackerDead } from '../../../../src/application/tracker/MarkTrackerDead.js';
import { RenderWhitelist } from '../../../../src/application/tracker/RenderWhitelist.js';
import { RenewTrackerCerts } from '../../../../src/application/tracker/RenewTrackerCerts.js';
import { TrackerNotFoundError } from '../../../../src/application/tracker/errors.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { TrackerHost } from '../../../../src/domain/tracker/TrackerHost.js';
import { InMemoryTrackerRepository } from '../../../../src/infrastructure/persistence/InMemoryTrackerRepository.js';
import { InMemoryUserAddressRepository } from '../../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { FakeCertStore } from '../../../../src/infrastructure/system/fakes/FakeCertStore.js';
import { FakeDnsResolver } from '../../../../src/infrastructure/system/fakes/FakeDnsResolver.js';
import { FakeNetworkServiceReload } from '../../../../src/infrastructure/system/fakes/FakeNetworkServiceReload.js';
import { FakeNotifications } from '../../../../src/infrastructure/system/fakes/FakeNotifications.js';
import { FakeRtorrentConfig } from '../../../../src/infrastructure/system/fakes/FakeRtorrentConfig.js';
import { FakeTrackerCert } from '../../../../src/infrastructure/system/fakes/FakeTrackerCert.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { aTracker } from '../../../builders/TrackerBuilder.js';

const NOW = '2026-07-24 10:00:00';
const TODAY = '2026-07-24';
const HOST = TrackerHost.parse('tracker.example.org');

let trackers: InMemoryTrackerRepository;
let addresses: InMemoryUserAddressRepository;
let dns: FakeDnsResolver;
let certPort: FakeTrackerCert;
let certStore: FakeCertStore;
let notifications: FakeNotifications;
let files: FakeRtorrentConfig;
let reload: FakeNetworkServiceReload;

beforeEach(() => {
  trackers = new InMemoryTrackerRepository();
  addresses = new InMemoryUserAddressRepository();
  dns = new FakeDnsResolver();
  certPort = new FakeTrackerCert();
  certStore = new FakeCertStore();
  notifications = new FakeNotifications();
  files = new FakeRtorrentConfig();
  reload = new FakeNetworkServiceReload();
});

function discoverUseCase() {
  return new DiscoverTrackerFromTorrent({ trackers, dns, notifications, certStore });
}

function fetchUseCase() {
  return new FetchTrackerCert({ trackers, certPort, certStore, notifications });
}

describe('DiscoverTrackerFromTorrent', () => {
  it('should_register_a_new_tracker_with_its_resolved_addresses', async () => {
    dns.givenAddresses('tracker.example.org', [IpAddress.parse('192.0.2.10')]);

    const report = await discoverUseCase().execute({
      url: 'https://tracker.example.org:2710/announce/secret',
      privacy: 'private',
      today: TODAY,
    });

    const saved = await trackers.findByHost(HOST);
    expect(saved?.port.value).toBe(2710);
    expect(saved?.privacy.value).toBe('private');
    expect(saved?.ipv4.map((ip) => ip.value)).toEqual(['192.0.2.10']);
    expect(report.certCheckWanted).toBe(true);
    expect(report.whitelistDirty).toBe(true);
    expect(notifications.published.map((e) => e.type)).toContain('TrackerDiscovered');
  });

  it('should_default_the_port_from_the_protocol', async () => {
    dns.givenAddresses('udp.example.io', [IpAddress.parse('192.0.2.20')]);

    const report = await discoverUseCase().execute({
      url: 'udp://udp.example.io/announce',
      privacy: 'public',
      today: TODAY,
    });

    const saved = await trackers.findByHost(TrackerHost.parse('udp.example.io'));
    expect(saved?.port.value).toBe(80); // legacy default for udp
    expect(report.certCheckWanted).toBe(false); // udp has no cert to check
  });

  it('should_update_addresses_of_a_known_tracker_without_new_discovery_event', async () => {
    await trackers.save(aTracker().withAddresses('192.0.2.10').build());
    dns.givenAddresses('tracker.example.org', [IpAddress.parse('192.0.2.12')]);

    const report = await discoverUseCase().execute({
      url: 'https://tracker.example.org/announce',
      privacy: 'private',
      today: TODAY,
    });

    const saved = await trackers.findByHost(HOST);
    expect(saved?.ipv4.map((ip) => ip.value)).toEqual(['192.0.2.12']);
    expect(report.whitelistDirty).toBe(true);
    expect(notifications.published).toHaveLength(0);
  });

  it('should_report_clean_when_a_known_tracker_is_unchanged', async () => {
    await trackers.save(aTracker().withAddresses('192.0.2.10').build());
    dns.givenAddresses('tracker.example.org', [IpAddress.parse('192.0.2.10')]);

    const report = await discoverUseCase().execute({
      url: 'https://tracker.example.org:443/announce',
      privacy: 'private',
      today: TODAY,
    });

    expect(report.whitelistDirty).toBe(false);
  });

  it('should_mark_a_known_tracker_dead_when_dns_no_longer_resolves', async () => {
    await trackers.save(aTracker().withAddresses('192.0.2.10').promotedUntil('2026-09-15').build());
    await certStore.install(HOST, 'PEM');

    const report = await discoverUseCase().execute({
      url: 'https://tracker.example.org/announce',
      privacy: 'private',
      today: TODAY,
    });

    const saved = await trackers.findByHost(HOST);
    expect(saved?.isDead).toBe(true);
    expect(saved?.isActive).toBe(false);
    expect(certStore.installed.has('tracker.example.org')).toBe(false);
    expect(notifications.published.map((e) => e.type)).toContain('TrackerDied');
    expect(report.whitelistDirty).toBe(true);
    expect(report.certCheckWanted).toBe(false);
  });

  it('should_never_insert_an_unresolvable_new_host', async () => {
    const report = await discoverUseCase().execute({
      url: 'https://gone.example.net/announce',
      privacy: 'private',
      today: TODAY,
    });

    expect(await trackers.findByHost(TrackerHost.parse('gone.example.net'))).toBeUndefined();
    expect(report.whitelistDirty).toBe(false);
  });

  it('should_not_revive_a_dead_tracker_on_re_announce', async () => {
    await trackers.save(aTracker().deadTracker().build());
    dns.givenAddresses('tracker.example.org', [IpAddress.parse('192.0.2.10')]);

    const report = await discoverUseCase().execute({
      url: 'https://tracker.example.org/announce',
      privacy: 'private',
      today: TODAY,
    });

    expect((await trackers.findByHost(HOST))?.isDead).toBe(true);
    expect(report.certCheckWanted).toBe(false);
  });
});

describe('FetchTrackerCert', () => {
  it('should_promote_a_tracker_and_install_its_certificate', async () => {
    await trackers.save(aTracker().withProto('http', 80).withAddresses('192.0.2.10').build());
    certPort.givenCert('tracker.example.org', { pem: 'PEM', expiresOn: '2026-09-15' });

    const report = await fetchUseCase().execute({ host: HOST, now: NOW });

    const saved = await trackers.findByHost(HOST);
    expect(saved?.isSsl).toBe(true);
    expect(saved?.proto.value).toBe('https');
    expect(saved?.certExpiry?.value).toBe('2026-09-15');
    expect(saved?.checkState.value).toBe('none');
    expect(certStore.installed.get('tracker.example.org')).toBe('PEM');
    expect(certStore.rehashCount).toBe(1);
    expect(report.promoted).toBe(true);
    expect(report.whitelistDirty).toBe(true);
  });

  it('should_notify_a_renewal_when_the_expiry_changes', async () => {
    await trackers.save(aTracker().promotedUntil('2026-07-25').build());
    certPort.givenCert('tracker.example.org', { pem: 'PEM2', expiresOn: '2026-10-01' });

    await fetchUseCase().execute({ host: HOST, now: NOW });

    expect(notifications.published).toEqual([
      { type: 'TrackerCertRenewed', host: 'tracker.example.org', expiresOn: '2026-10-01' },
    ]);
  });

  it('should_leave_a_plain_tracker_unpromoted_when_no_cert_is_served', async () => {
    await trackers.save(aTracker().withProto('http', 80).build());

    const report = await fetchUseCase().execute({ host: HOST, now: NOW });

    const saved = await trackers.findByHost(HOST);
    expect(saved?.isSsl).toBe(false);
    expect(saved?.proto.value).toBe('http');
    expect(saved?.checkState.value).toBe('none');
    expect(saved?.lastCheck).toBe(NOW);
    expect(report.promoted).toBe(false);
    expect(report.whitelistDirty).toBe(false);
  });

  it('should_restore_the_pending_state_when_the_port_fails_hard', async () => {
    await trackers.save(aTracker().build());
    const failing = new FetchTrackerCert({
      trackers,
      certPort: {
        fetch: () => Promise.reject(new Error('openssl exploded')),
      },
      certStore,
      notifications,
    });

    await expect(failing.execute({ host: HOST, now: NOW })).rejects.toThrow(/openssl exploded/);

    // no tracker may stay stuck in 'checking' (the legacy to_check=3 leak)
    expect((await trackers.findByHost(HOST))?.checkState.value).toBe('pending');
  });

  it('should_keep_the_promotion_and_retry_later_when_a_renewal_probe_gets_nothing', async () => {
    // a transient timeout on renewal day must NOT demote the tracker and
    // silently end its cert monitoring — keep state, retry on the next sweep
    await trackers.save(aTracker().promotedUntil('2026-07-25').build());
    await certStore.install(HOST, 'PEM');

    const report = await fetchUseCase().execute({ host: HOST, now: NOW });

    const saved = await trackers.findByHost(HOST);
    expect(saved?.isSsl).toBe(true);
    expect(saved?.certExpiry?.value).toBe('2026-07-25');
    expect(saved?.checkState.value).toBe('pending');
    expect(saved?.lastCheck).toBe(NOW);
    expect(certStore.installed.has('tracker.example.org')).toBe(true);
    expect(report.promoted).toBe(false);
    expect((await trackers.listNeedingCertCheck('2026-07-24')).map((t) => t.host.value)).toEqual([
      'tracker.example.org',
    ]);
  });

  it('should_release_the_lock_when_the_store_or_save_fails_after_fetch', async () => {
    await trackers.save(aTracker().build());
    certPort.givenCert('tracker.example.org', { pem: 'PEM', expiresOn: '2026-09-15' });
    const failingStore = {
      install: () => Promise.reject(new Error('disk full')),
      remove: () => Promise.resolve(),
      rehash: () => Promise.resolve(),
    };
    const failing = new FetchTrackerCert({
      trackers,
      certPort,
      certStore: failingStore,
      notifications,
    });

    await expect(failing.execute({ host: HOST, now: NOW })).rejects.toThrow(/disk full/);

    expect((await trackers.findByHost(HOST))?.checkState.value).toBe('pending');
  });

  it('should_reselect_a_tracker_stuck_in_checking_after_a_worker_crash', async () => {
    // a crash between beginCheck and completeCheck must self-heal on the
    // next renewal sweep
    await trackers.save(aTracker().build().beginCheck());

    const due = await trackers.listNeedingCertCheck('2026-07-24');

    expect(due.map((t) => t.host.value)).toEqual(['tracker.example.org']);
  });

  it('should_skip_a_dead_tracker', async () => {
    await trackers.save(aTracker().deadTracker().build());

    const report = await fetchUseCase().execute({ host: HOST, now: NOW });

    expect(report.promoted).toBe(false);
    expect(certPort.fetchedHosts).toEqual([]);
  });

  it('should_fail_on_an_unknown_tracker', async () => {
    await expect(fetchUseCase().execute({ host: HOST, now: NOW })).rejects.toThrow(
      TrackerNotFoundError,
    );
  });
});

describe('RenewTrackerCerts', () => {
  it('should_check_every_due_tracker_and_isolate_failures', async () => {
    await trackers.save(aTracker().withHost('a.example.org').build()); // pending
    await trackers.save(aTracker().withHost('b.example.org').promotedUntil('2026-07-25').build()); // due
    await trackers.save(aTracker().withHost('c.example.org').promotedUntil('2026-12-31').build()); // fresh
    certPort.givenCert('a.example.org', { pem: 'A', expiresOn: '2026-10-01' });
    // b.example.org serves nothing anymore -> unpromoted, but not an error

    const report = await new RenewTrackerCerts({ trackers, fetchCert: fetchUseCase() }).execute({
      today: TODAY,
      now: NOW,
    });

    expect(report.checked).toBe(2);
    expect(report.promoted).toBe(1);
    expect(report.failed).toBe(0);
    expect((await trackers.findByHost(TrackerHost.parse('c.example.org')))?.certExpiry?.value).toBe(
      '2026-12-31',
    );
  });

  it('should_count_hard_failures_and_continue', async () => {
    await trackers.save(aTracker().withHost('a.example.org').build());
    await trackers.save(aTracker().withHost('b.example.org').build());
    const failingPort = {
      fetch: (host: TrackerHost) =>
        host.value === 'a.example.org'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(undefined),
    };
    const renew = new RenewTrackerCerts({
      trackers,
      fetchCert: new FetchTrackerCert({ trackers, certPort: failingPort, certStore, notifications }),
    });

    const report = await renew.execute({ today: TODAY, now: NOW });

    expect(report.failed).toBe(1);
    expect(report.checked).toBe(2);
  });
});

describe('MarkTrackerDead', () => {
  it('should_deactivate_notify_and_drop_the_cert', async () => {
    await trackers.save(aTracker().promotedUntil('2026-09-15').build());
    await certStore.install(HOST, 'PEM');

    const report = await new MarkTrackerDead({ trackers, certStore, notifications }).execute({
      host: HOST,
    });

    expect((await trackers.findByHost(HOST))?.isDead).toBe(true);
    expect(certStore.installed.size).toBe(0);
    expect(notifications.published.map((e) => e.type)).toEqual(['TrackerDied']);
    expect(report.whitelistDirty).toBe(true);
  });

  it('should_be_idempotent', async () => {
    await trackers.save(aTracker().deadTracker().build());

    const report = await new MarkTrackerDead({ trackers, certStore, notifications }).execute({
      host: HOST,
    });

    expect(report.whitelistDirty).toBe(false);
    expect(notifications.published).toHaveLength(0);
  });
});

describe('RenderWhitelist', () => {
  it('should_apply_the_three_network_files_and_reload_services_when_changed', async () => {
    await trackers.save(aTracker().withAddresses('192.0.2.10').build());
    await addresses.add(Username.parse('alice'), IpAddress.parse('198.51.100.7'));

    const useCase = new RenderWhitelist({ trackers, addresses, files, reload });
    const report = await useCase.execute();

    expect(report.changedFiles).toEqual([
      '/etc/bind/kobox.zones.blacklists',
      '/etc/dnscrypt-proxy/blocked-names.txt',
      '/etc/pgl/allow.p2p',
    ]);
    expect(files.contentAt('/etc/pgl/allow.p2p')).toContain(
      'tracker.example.org:192.0.2.10-255.255.255.255',
    );
    expect(reload.dnsReloads).toBe(1);
    expect(reload.peerGuardianReloads).toBe(1);

    // idempotence: a second render changes nothing and reloads nothing
    const second = await useCase.execute();
    expect(second.changedFiles).toEqual([]);
    expect(reload.dnsReloads).toBe(1);
  });
});

describe('ManageUserAddress', () => {
  it('should_add_and_remove_addresses_and_flag_the_whitelist_dirty', async () => {
    const useCase = new ManageUserAddress({ addresses });

    const added = await useCase.execute({
      action: 'add',
      username: Username.parse('alice'),
      ip: IpAddress.parse('198.51.100.7'),
    });
    expect(added.whitelistDirty).toBe(true);
    expect(await addresses.listAll()).toHaveLength(1);

    const removed = await useCase.execute({
      action: 'remove',
      username: Username.parse('alice'),
      ip: IpAddress.parse('198.51.100.7'),
    });
    expect(removed.whitelistDirty).toBe(true);
    expect(await addresses.listAll()).toHaveLength(0);
  });
});
