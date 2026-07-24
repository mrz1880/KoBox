import type { TorrentInstanceRepository, TorrentRepository } from '../../domain/torrent/ports.js';
import type { ServiceControlPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

export interface DeprovisionRtorrentInstanceCommand {
  readonly username: Username;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
  readonly torrents: TorrentRepository;
  readonly services: ServiceControlPort;
}

// Reverse of provisioning, idempotent: safe to run for a user that was never
// provisioned (delete-user must always converge).
export class DeprovisionRtorrentInstance {
  constructor(private readonly deps: Deps) {}

  async execute(command: DeprovisionRtorrentInstanceCommand): Promise<void> {
    const { instances, torrents, services } = this.deps;
    await services.removeUserService(command.username);
    await torrents.deleteAllFor(command.username);
    await instances.delete(command.username);
  }
}
