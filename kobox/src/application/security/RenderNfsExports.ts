import { renderNfsExports, type NfsExportWiring } from '../../domain/installation/rendering.js';
import type { NetworkServicePort } from '../../domain/security/ports.js';
import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { UserAddressRepository } from '../../domain/tracker/ports.js';
import type { UserRepository } from '../../domain/user/ports.js';

interface Deps {
  readonly users: UserRepository;
  readonly addresses: UserAddressRepository;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServicePort;
}

// Whole-state render of the per-user NFS home exports (KEEP from prod): each
// active user's home is exported only to their own trusted addresses, never a
// wildcard. Declarative + idempotent — a removed address or a suspended user
// drops off the next render.
export class RenderNfsExports {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const { users, addresses, files, reload } = this.deps;
    const active = (await users.listAll()).filter((user) => !user.status.isSuspended());
    const byUser = new Map<string, string[]>();
    for (const address of await addresses.listAll()) {
      const list = byUser.get(address.username.value) ?? [];
      list.push(address.ip.value);
      byUser.set(address.username.value, list);
    }
    const wirings: NfsExportWiring[] = active.map((user) => ({
      username: user.username.value,
      ips: byUser.get(user.username.value) ?? [],
    }));

    const changed = await files.apply([renderNfsExports(wirings)]);
    if (changed.length > 0) {
      await reload.reloadNfsExports();
    }
  }
}
