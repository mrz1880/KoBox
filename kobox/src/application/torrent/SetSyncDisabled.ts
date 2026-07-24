import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { TorrentInstanceNotFoundError } from './errors.js';

export interface SetSyncDisabledCommand {
  readonly username: Username;
  readonly disabled: boolean;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
}

// DB-backed behavior flag (converted prod patch): read at event time,
// no file render, no restart — it survives every regeneration by design.
export class SetSyncDisabled {
  constructor(private readonly deps: Deps) {}

  async execute(command: SetSyncDisabledCommand): Promise<void> {
    const instance = await this.deps.instances.findByUsername(command.username);
    if (!instance) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }
    await this.deps.instances.save(instance.setSyncDisabled(command.disabled));
  }
}
