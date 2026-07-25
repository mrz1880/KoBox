import { FirewallPolicy, type FirewallUser } from '../../domain/security/FirewallPolicy.js';
import type {
  FirewallApplyOutcome,
  FirewallApplyPort,
  NetworkServicePort,
  SecurityNotificationPort,
  UserIdentityPort,
} from '../../domain/security/ports.js';
import { renderFirewallRules } from '../../domain/security/rendering.js';
import type { UserAddressRepository } from '../../domain/tracker/ports.js';
import type { UserRepository } from '../../domain/user/ports.js';
import { FirewallRolledBackError } from './errors.js';
import type { SecuritySettings } from './settings.js';

export interface ApplyFirewallReport {
  readonly outcome: FirewallApplyOutcome;
  readonly skippedUsers: readonly string[];
}

interface Deps {
  readonly users: UserRepository;
  readonly addresses: UserAddressRepository;
  readonly identity: UserIdentityPort;
  readonly firewall: FirewallApplyPort;
  readonly reload: NetworkServicePort;
  readonly notifications: SecurityNotificationPort;
  readonly settings: SecuritySettings;
}

// Whole-state firewall reconciliation. A rollback is a loud failure: silent
// lockout-avoidance would hide a broken policy until the next lockout attempt.
export class ApplyFirewall {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<ApplyFirewallReport> {
    const { users, addresses, identity, firewall, reload, notifications, settings } = this.deps;

    const allAddresses = await addresses.listAll();
    const firewallUsers: FirewallUser[] = [];
    const skippedUsers: string[] = [];
    for (const user of await users.listAll()) {
      const uid = await identity.uidOf(user.username);
      if (uid === undefined) {
        // DB row without a system account (mid-provisioning): a policy that
        // cannot name the uid cannot meter it — skip and say so.
        skippedUsers.push(user.username.value);
        continue;
      }
      firewallUsers.push({
        username: user.username,
        uid,
        rtorrentPort: user.rtorrentPort.value,
        addresses: allAddresses
          .filter((address) => address.username.equals(user.username))
          .map((address) => address.ip),
      });
    }

    const policy = FirewallPolicy.create({
      sshPort: settings.sshPort,
      portalPort: settings.portalPort,
      vpn: settings.vpn,
      users: firewallUsers,
    });
    const outcome = await firewall.apply(renderFirewallRules(policy));
    // re-ensured every run (a Docker restart can rebuild the shared nat
    // table): targeted append, never part of the restored ruleset
    if (outcome !== 'rolled-back') {
      await firewall.ensureMasquerade(settings.vpn.tunGwSubnet);
    }

    if (outcome === 'rolled-back') {
      await notifications.notify({ type: 'FirewallApplied', outcome: 'rolled-back' });
      throw new FirewallRolledBackError();
    }
    if (outcome === 'applied') {
      // the restore wiped pgl's own chains — let pglcmd repopulate its seam
      await reload.reloadPeerGuardian();
      await notifications.notify({ type: 'FirewallApplied', outcome: 'applied' });
    }
    return { outcome, skippedUsers };
  }
}
