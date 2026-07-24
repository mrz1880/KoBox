import { beforeEach, describe, expect, it } from 'vitest';
import { ManageUserHostname } from '../../../../src/application/security/ManageUserHostname.js';
import { ResolveDynDns } from '../../../../src/application/security/ResolveDynDns.js';
import { DynDnsHost } from '../../../../src/domain/security/DynDnsHost.js';
import type { SecurityEvent } from '../../../../src/domain/security/events.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryUserAddressRepository } from '../../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { FakeDynDnsResolver } from '../../../../src/infrastructure/system/fakes/FakeDynDnsResolver.js';

class RecordingSecurityNotifications {
  readonly published: SecurityEvent[] = [];

  notify(event: SecurityEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}

const alice = Username.parse('alice');
const host = DynDnsHost.parse('dyn.example.org');

let addresses: InMemoryUserAddressRepository;
let resolver: FakeDynDnsResolver;
let notifications: RecordingSecurityNotifications;
let manage: ManageUserHostname;
let resolve: ResolveDynDns;

beforeEach(() => {
  addresses = new InMemoryUserAddressRepository();
  resolver = new FakeDynDnsResolver();
  notifications = new RecordingSecurityNotifications();
  manage = new ManageUserHostname({ bindings: addresses });
  resolve = new ResolveDynDns({ bindings: addresses, resolver, notifications });
});

describe('ManageUserHostname', () => {
  it('should_add_a_binding_without_touching_anything_until_resolution', async () => {
    const report = await manage.execute({ action: 'add', username: alice, host });

    expect(report).toEqual({ whitelistDirty: false, firewallDirty: false, fail2banDirty: false });
    expect(await addresses.listHostnames()).toHaveLength(1);
    expect(await addresses.listAll()).toHaveLength(0);
  });

  it('should_mark_everything_dirty_when_removing_a_resolved_binding', async () => {
    await manage.execute({ action: 'add', username: alice, host });
    await addresses.updateResolvedIp(alice, host, IpAddress.parse('203.0.113.9'));

    const report = await manage.execute({ action: 'remove', username: alice, host });

    expect(report).toEqual({ whitelistDirty: true, firewallDirty: true, fail2banDirty: true });
    expect(await addresses.listHostnames()).toHaveLength(0);
  });

  it('should_stay_clean_when_removing_an_unresolved_binding', async () => {
    await manage.execute({ action: 'add', username: alice, host });

    const report = await manage.execute({ action: 'remove', username: alice, host });

    expect(report).toEqual({ whitelistDirty: false, firewallDirty: false, fail2banDirty: false });
  });
});

describe('ResolveDynDns', () => {
  beforeEach(async () => {
    await manage.execute({ action: 'add', username: alice, host });
  });

  it('should_record_the_first_resolution_notify_and_mark_dirty', async () => {
    resolver.setAnswer('dyn.example.org', IpAddress.parse('203.0.113.9'));

    const report = await resolve.execute();

    expect(report.changed).toBe(1);
    expect(report.whitelistDirty).toBe(true);
    expect(report.firewallDirty).toBe(true);
    expect(report.fail2banDirty).toBe(true);
    expect((await addresses.listAll())[0]?.ip.value).toBe('203.0.113.9');
    expect(notifications.published).toEqual([
      {
        type: 'DynDnsAddressChanged',
        username: 'alice',
        host: 'dyn.example.org',
        newIp: '203.0.113.9',
      },
    ]);
  });

  it('should_do_nothing_when_the_address_is_stable', async () => {
    resolver.setAnswer('dyn.example.org', IpAddress.parse('203.0.113.9'));
    await resolve.execute();
    notifications.published.length = 0;

    const report = await resolve.execute();

    expect(report.changed).toBe(0);
    expect(report.whitelistDirty).toBe(false);
    expect(notifications.published).toHaveLength(0);
  });

  it('should_track_an_ip_change_with_the_old_address_in_the_event', async () => {
    resolver.setAnswer('dyn.example.org', IpAddress.parse('203.0.113.9'));
    await resolve.execute();
    resolver.setAnswer('dyn.example.org', IpAddress.parse('203.0.113.77'));

    const report = await resolve.execute();

    expect(report.changed).toBe(1);
    expect((await addresses.listAll())[0]?.ip.value).toBe('203.0.113.77');
    expect(notifications.published.at(-1)).toEqual({
      type: 'DynDnsAddressChanged',
      username: 'alice',
      host: 'dyn.example.org',
      oldIp: '203.0.113.9',
      newIp: '203.0.113.77',
    });
  });

  it('should_keep_the_last_known_address_when_resolution_fails', async () => {
    // a flapping dyndns must never evict a user (grace semantics)
    resolver.setAnswer('dyn.example.org', IpAddress.parse('203.0.113.9'));
    await resolve.execute();
    resolver.clearAnswer('dyn.example.org');

    const report = await resolve.execute();

    expect(report.changed).toBe(0);
    expect(report.unresolved).toBe(1);
    expect((await addresses.listAll())[0]?.ip.value).toBe('203.0.113.9');
  });
});
