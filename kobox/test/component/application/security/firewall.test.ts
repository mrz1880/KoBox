import { beforeEach, describe, expect, it } from 'vitest';
import { ApplyFirewall } from '../../../../src/application/security/ApplyFirewall.js';
import { FirewallRolledBackError } from '../../../../src/application/security/errors.js';
import type { SecuritySettings } from '../../../../src/application/security/settings.js';
import { Cidr } from '../../../../src/domain/security/Cidr.js';
import type { SecurityEvent } from '../../../../src/domain/security/events.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryUserAddressRepository } from '../../../../src/infrastructure/persistence/InMemoryUserAddressRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeFirewallApply } from '../../../../src/infrastructure/system/fakes/FakeFirewallApply.js';
import { FakeNetworkServices } from '../../../../src/infrastructure/system/fakes/FakeNetworkServices.js';
import { FakeUserIdentity } from '../../../../src/infrastructure/system/fakes/FakeUserIdentity.js';
import { aUser } from '../../../builders/UserBuilder.js';

class RecordingSecurityNotifications {
  readonly published: SecurityEvent[] = [];

  notify(event: SecurityEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}

export const testSettings: SecuritySettings = {
  sshPort: 22,
  portalPort: 8189,
  vpn: {
    tunGwPort: 8193,
    tunPort: 8194,
    tapPort: 8195,
    tunGwSubnet: Cidr.parse('10.0.0.0/24'),
    tunSubnet: Cidr.parse('10.0.1.0/24'),
    tapSubnet: Cidr.parse('10.0.2.0/24'),
  },
};

let repo: InMemoryUserRepository;
let addresses: InMemoryUserAddressRepository;
let identity: FakeUserIdentity;
let firewall: FakeFirewallApply;
let reload: FakeNetworkServices;
let ipset: FakeIpset;
let notifications: RecordingSecurityNotifications;
let useCase: ApplyFirewall;

class FakeIpset {
  supported = true;
  readonly restored: string[] = [];

  ensureBlocklistSet(): Promise<boolean> {
    return Promise.resolve(this.supported);
  }

  restore(filePath: string): Promise<void> {
    this.restored.push(filePath);
    return Promise.resolve();
  }
}

beforeEach(() => {
  repo = new InMemoryUserRepository();
  addresses = new InMemoryUserAddressRepository();
  identity = new FakeUserIdentity();
  firewall = new FakeFirewallApply();
  reload = new FakeNetworkServices();
  ipset = new FakeIpset();
  notifications = new RecordingSecurityNotifications();
  useCase = new ApplyFirewall({
    users: repo,
    addresses,
    identity,
    firewall,
    reload,
    ipset,
    notifications,
    settings: testSettings,
  });
});

describe('ApplyFirewall', () => {
  it('should_render_the_policy_from_users_uids_and_addresses_then_apply_it', async () => {
    await repo.save(aUser().build());
    identity.setUid('alice', 1001);
    await addresses.add(Username.parse('alice'), IpAddress.parse('198.51.100.7'));

    const report = await useCase.execute();

    expect(report.outcome).toBe('applied');
    const content = firewall.applied[0]?.content ?? '';
    expect(content).toContain(':kobox-u-alice - [0:0]');
    expect(content).toContain('-m owner --uid-owner 1001');
    expect(content).toContain('-A INPUT -p tcp --dport 45000 -j kobox-u-alice');
    expect(content).toContain(
      '-A INPUT -s 198.51.100.7 -m comment --comment "kobox:trusted:alice" -j ACCEPT',
    );
  });

  it('should_notify_only_when_rules_actually_changed', async () => {
    await repo.save(aUser().build());
    identity.setUid('alice', 1001);

    await useCase.execute();
    expect(notifications.published).toEqual([{ type: 'FirewallApplied', outcome: 'applied' }]);

    const second = await useCase.execute();
    expect(second.outcome).toBe('unchanged');
    expect(notifications.published).toHaveLength(1);
  });

  it('should_include_the_blocklist_drop_only_when_the_kernel_accepts_the_set', async () => {
    await repo.save(aUser().build());
    identity.setUid('alice', 1001);

    await useCase.execute();
    expect(firewall.applied[0]?.content ?? '').toContain(
      '-A INPUT -m set --match-set kobox-bl src -j DROP',
    );

    // a host without the ip_set module still converges, without the rule
    ipset.supported = false;
    const degraded = new ApplyFirewall({
      users: repo,
      addresses,
      identity,
      firewall,
      reload,
      ipset,
      notifications,
      settings: testSettings,
    });
    await degraded.execute();
    expect(firewall.applied.at(-1)?.content ?? '').not.toContain('--match-set');
  });

  it('should_ensure_the_vpn_masquerade_outside_the_rendered_ruleset', async () => {
    // nat is shared with Docker: never restored wholesale, always a targeted
    // check-then-add — and re-ensured on EVERY run (unchanged included)
    await repo.save(aUser().build());
    identity.setUid('alice', 1001);

    await useCase.execute();
    await useCase.execute(); // unchanged run

    expect(firewall.masquerades).toEqual(['10.0.0.0/24', '10.0.0.0/24']);
    expect(firewall.applied[0]?.content ?? '').not.toContain('MASQUERADE');
  });

  it('should_skip_users_without_a_system_account_and_report_them', async () => {
    await repo.save(aUser().build());
    await repo.save(aUser().withUsername('bob').withScgiPort(51102).withRtorrentPort(45001).build());
    identity.setUid('alice', 1001); // bob has no uid yet

    const report = await useCase.execute();

    expect(report.skippedUsers).toEqual(['bob']);
    const content = firewall.applied[0]?.content ?? '';
    expect(content).toContain('kobox-u-alice');
    expect(content).not.toContain('kobox-u-bob');
  });

  it('should_fail_loudly_and_notify_when_the_lifeline_probe_rolled_back', async () => {
    await repo.save(aUser().build());
    identity.setUid('alice', 1001);
    firewall.failNextWithRollback();

    await expect(useCase.execute()).rejects.toThrow(FirewallRolledBackError);
    expect(notifications.published).toEqual([
      { type: 'FirewallApplied', outcome: 'rolled-back' },
    ]);
  });
});
