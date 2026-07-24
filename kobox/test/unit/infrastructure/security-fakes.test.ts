import { describe, expect, it } from 'vitest';
import { Bandwidth } from '../../../src/domain/security/Bandwidth.js';
import { DynDnsHost } from '../../../src/domain/security/DynDnsHost.js';
import { IpAddress } from '../../../src/domain/shared/IpAddress.js';
import { Username } from '../../../src/domain/user/Username.js';
import { InMemoryFairUseRepository } from '../../../src/infrastructure/persistence/InMemoryFairUseRepository.js';
import { InMemoryUserAddressRepository } from '../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { FakeFirewallApply } from '../../../src/infrastructure/system/fakes/FakeFirewallApply.js';
import { FakeNetworkServices } from '../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeShaping } from '../../../src/infrastructure/system/fakes/FakeShaping.js';
import { FakeSshAuthLog } from '../../../src/infrastructure/system/fakes/FakeSshAuthLog.js';
import { FakeUsageMeter } from '../../../src/infrastructure/system/fakes/FakeUsageMeter.js';
import { FakeUserIdentity } from '../../../src/infrastructure/system/fakes/FakeUserIdentity.js';

const alice = Username.parse('alice');

describe('InMemoryUserAddressRepository (dyndns bindings)', () => {
  it('should_mirror_the_sqlite_contract_for_hostname_rows', async () => {
    const repo = new InMemoryUserAddressRepository();
    const host = DynDnsHost.parse('dyn.example.org');

    await repo.addHostname(alice, host);
    await repo.addHostname(alice, host);
    expect(await repo.listAll()).toHaveLength(0);
    expect(await repo.listHostnames()).toHaveLength(1);

    await repo.updateResolvedIp(alice, host, IpAddress.parse('203.0.113.9'));
    expect((await repo.listAll())[0]?.ip.value).toBe('203.0.113.9');

    await repo.removeHostname(alice, host);
    expect(await repo.listHostnames()).toHaveLength(0);
    expect(await repo.listAll()).toHaveLength(0);
  });
});

describe('InMemoryFairUseRepository', () => {
  it('should_mirror_the_sqlite_contract', async () => {
    const repo = new InMemoryFairUseRepository();
    expect(await repo.getState(alice)).toEqual({ level: 'none', healthState: 'healthy' });

    await repo.saveState(alice, { level: 'alerted', healthState: 'healthy' }, 't1');
    expect((await repo.getState(alice)).level).toBe('alerted');

    await repo.appendEvent(alice, 'FairUseBreached', '{}', 't1');
    await repo.appendEvent(alice, 'UserThrottled', '{}', 't2');
    expect((await repo.listEvents(alice)).map((e) => e.eventType)).toEqual([
      'FairUseBreached',
      'UserThrottled',
    ]);

    expect(await repo.overridesFor(alice)).toBeUndefined();
    await repo.saveOverrides(alice, { maxAuthPerHour: 99 });
    expect((await repo.overridesFor(alice))?.maxAuthPerHour).toBe(99);

    expect(await repo.lastSample(alice)).toBeUndefined();
    await repo.putSample(alice, { egressBytes: 10, ingressBytes: 5, sampledAt: 't1' });
    expect((await repo.lastSample(alice))?.egressBytes).toBe(10);
  });
});

describe('security fakes', () => {
  it('fake_firewall_apply_records_files_and_returns_the_scripted_outcome', async () => {
    const fake = new FakeFirewallApply();
    const file = { path: '/etc/kobox/firewall.rules', content: 'x', mode: '0600', owner: 'root', group: 'root' };
    expect(await fake.apply(file)).toBe('applied');
    expect(await fake.apply(file)).toBe('unchanged'); // same content: idempotent
    fake.failNextWithRollback();
    expect(await fake.apply({ ...file, content: 'y' })).toBe('rolled-back');
    expect(fake.applied).toHaveLength(3);
  });

  it('fake_shaping_tracks_throttled_uids', async () => {
    const fake = new FakeShaping();
    expect(await fake.isThrottled(1001)).toBe(false);
    await fake.throttle(alice, 1001, Bandwidth.mbit(5));
    expect(await fake.isThrottled(1001)).toBe(true);
    expect(fake.throttled.get(1001)?.rate.bps).toBe(5_000_000);
    await fake.unthrottle(alice, 1001);
    expect(await fake.isThrottled(1001)).toBe(false);
  });

  it('fake_meter_auth_log_and_identity_return_scripted_values', async () => {
    const meter = new FakeUsageMeter();
    meter.setCounter('alice', 1_000, 500);
    expect(await meter.readCounters()).toEqual([
      { username: 'alice', egressBytes: 1_000, ingressBytes: 500 },
    ]);

    const authLog = new FakeSshAuthLog();
    authLog.setCount('alice', 82);
    expect(await authLog.countAcceptedPublickey(alice, 60)).toBe(82);
    expect(await authLog.countAcceptedPublickey(Username.parse('bob'), 60)).toBe(0);

    const identity = new FakeUserIdentity();
    identity.setUid('alice', 1001);
    expect(await identity.uidOf(alice)).toBe(1001);
    expect(await identity.uidOf(Username.parse('bob'))).toBeUndefined();
  });

  it('fake_network_services_records_reloads_and_can_be_scripted_to_fail', async () => {
    const fake = new FakeNetworkServices();
    await fake.reloadFail2ban();
    await fake.reloadDns();
    await fake.reloadPeerGuardian();
    expect(fake.reloads).toEqual(['fail2ban', 'dns', 'pgl']);

    fake.failWith(new Error('rndc: connect failed'));
    await expect(fake.reloadDns()).rejects.toThrow('rndc: connect failed');
  });
});
