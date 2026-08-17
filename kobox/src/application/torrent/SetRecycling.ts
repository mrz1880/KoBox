import type { RecyclingMode } from '../../domain/torrent/RecyclingMode.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { TorrentInstanceNotFoundError } from './errors.js';

interface Deps {
  readonly instances: TorrentInstanceRepository;
}

// Changes what happens to future adds only. Nothing already on disk is copied,
// linked or unlinked by this: turning hardlinking off does not un-share blocks
// that are already shared, and the page says so.
export class SetRecycling {
  constructor(private readonly deps: Deps) {}

  async execute(command: { username: Username; mode: RecyclingMode }): Promise<void> {
    const instance = await this.deps.instances.findByUsername(command.username);
    if (instance === undefined) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }
    await this.deps.instances.save(instance.setRecycling(command.mode));
  }
}
