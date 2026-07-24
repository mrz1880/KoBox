import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { TorrentInstanceNotFoundError } from './errors.js';

export interface SetAllowPublicTrackerCommand {
  readonly username: Username;
  readonly allowed: boolean;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
}

// DB-backed behavior flag (converted prod patch): enforced by the admission
// policy in HandleTorrentEvent, never baked into rendered files.
export class SetAllowPublicTracker {
  constructor(private readonly deps: Deps) {}

  async execute(command: SetAllowPublicTrackerCommand): Promise<void> {
    const instance = await this.deps.instances.findByUsername(command.username);
    if (!instance) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }
    await this.deps.instances.save(instance.setAllowPublicTracker(command.allowed));
  }
}
