import { departureOf, type Departure } from '../../domain/sync/Departure.js';
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
// rtorrent does not need to know. Nothing to render, nothing to restart, which
// is why this is not chained to RenderRtorrentConfig like adding a category is.
// It reports when what already waits in the folder now leaves: a folder
// switched to "straight away" sends its waiting transfers at once.
export class SetCategorySyncMode {
  constructor(private readonly deps: Deps) {}

  async execute(command: SetCategorySyncModeCommand): Promise<Departure> {
    const instance = await this.deps.instances.findByUsername(command.username);
    if (!instance) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }
    const changed = instance.setSyncMode(command.label, command.mode);
    await this.deps.instances.save(changed);
    return departureOf(changed, command.label);
  }
}
