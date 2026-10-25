import {
  renderRutorrentUserConfig,
  renderRutorrentUsersInclude,
  type RutorrentUserWiring,
} from '../../domain/installation/rendering.js';
import type { NetworkServicePort } from '../../domain/security/ports.js';
import type { RenderedFile } from '../../domain/shared/files.js';
import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { RutorrentProfilePort } from '../../domain/torrent/ports.js';
import type { UserRepository } from '../../domain/user/ports.js';

interface Deps {
  readonly users: UserRepository;
  readonly files: ManagedFilesPort;
  readonly reload: NetworkServicePort;
  readonly profiles: RutorrentProfilePort;
}

// Renders the per-user nginx SCGI mounts (/RPC-<USER>) and the matching
// ruTorrent per-user configs, then reloads nginx. Declarative + idempotent:
// the whole set is re-rendered from the active user population, so a removed
// user's mount disappears on the next run (no stale /RPC- left behind).
export class RenderRutorrentUsers {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const { users, files, reload, profiles } = this.deps;
    const active = (await users.listAll()).filter((user) => !user.status.isSuspended());
    const wirings: RutorrentUserWiring[] = active.map((user) => ({
      username: user.username.value,
      scgiPort: user.scgiPort.value,
    }));

    const rendered: RenderedFile[] = [
      renderRutorrentUsersInclude(wirings),
      ...wirings.map((wiring) => renderRutorrentUserConfig(wiring)),
    ];
    await files.apply(rendered);
    for (const user of active) {
      await profiles.ensureProfile(user.username);
    }
    await reload.reloadNginx();
  }
}
