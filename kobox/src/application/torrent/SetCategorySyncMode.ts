import type { Label } from '../../domain/torrent/Label.js';
import type { SyncMode } from '../../domain/torrent/SyncMode.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { TorrentInstanceNotFoundError } from './errors.js';

export interface SetCategorySyncModeCommand {
  readonly username: Username;
  readonly label: Label;
  readonly mode: SyncMode;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
}

// Changing a mode touches no file on disk: the directories already exist, and
// rtorrent does not need to know. Nothing to render, nothing to restart — which
// is why this is not chained to RenderRtorrentConfig like adding a category is.
export class SetCategorySyncMode {
  constructor(private readonly deps: Deps) {}

  async execute(command: SetCategorySyncModeCommand): Promise<void> {
    const instance = await this.deps.instances.findByUsername(command.username);
    if (!instance) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }
    await this.deps.instances.save(instance.setSyncMode(command.label, command.mode));
  }
}
