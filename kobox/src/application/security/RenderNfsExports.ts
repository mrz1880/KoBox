import { renderNfsExports, type NfsExportWiring } from '../../domain/installation/rendering.js';
import type { NetworkServicePort, UserIdentityPort } from '../../domain/security/ports.js';
import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { UserAddressRepository } from '../../domain/tracker/ports.js';
import { VPN_VARIANTS, subnetOf } from '../../domain/security/vpn.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { SecuritySettings } from './settings.js';

interface Deps {
  readonly users: UserRepository;
  readonly addresses: UserAddressRepository;
  readonly identity: UserIdentityPort;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServicePort;
  readonly settings: SecuritySettings;
}

// Whole-state render of the per-member NFS home exports (KEEP from prod): each
// active member's home is exported to their own address in every VPN tunnel and
// to the trusted addresses added by hand, never to a subnet or a wildcard.
// Declarative and idempotent: a removed address or a suspended member drops off
// the next render.
export class RenderNfsExports {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const { users, addresses, identity, files, reload, settings } = this.deps;
    const active = (await users.listAll()).filter((user) => !user.status.isSuspended());
    const byUser = new Map<string, string[]>();
    for (const address of await addresses.listAll()) {
      const list = byUser.get(address.username.value) ?? [];
      list.push(address.ip.value);
      byUser.set(address.username.value, list);
    }
    const wirings: NfsExportWiring[] = [];
    for (const user of active) {
      const { vpnHost } = user;
      const tunnels =
        vpnHost === undefined
          ? []
          : VPN_VARIANTS.map((variant) => subnetOf(variant, settings.vpn).addressOf(vpnHost));
      const ids = await identity.idsOf(user.username);
      if (ids === undefined) {
        // no system account behind the row: nothing to map a client onto
        continue;
      }
      wirings.push({
        username: user.username,
        ids,
        clients: [...tunnels, ...(byUser.get(user.username.value) ?? [])],
      });
    }

    const changed = await files.apply([renderNfsExports(wirings)]);
    if (changed.length > 0) {
      await reload.reloadNfsExports();
    }
  }
}
