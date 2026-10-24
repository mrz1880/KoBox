import type { Label } from '../../domain/torrent/Label.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { TorrentInstanceNotFoundError } from './errors.js';

export interface AddWatchDirCommand {
  readonly username: Username;
  readonly label: Label;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
}

// Whether the folder is new, so the caller knows a render is due. The render
// (and the rTorrent restart it brings) is left to its own job: several folders
// added in a row must cost one restart, since systemd refuses a sixth start
// within ten seconds.
export interface AddWatchDirReport {
  readonly added: boolean;
}

export class AddWatchDir {
  constructor(private readonly deps: Deps) {}

  async execute(command: AddWatchDirCommand): Promise<AddWatchDirReport> {
    const { instances } = this.deps;

    const instance = await instances.findByUsername(command.username);
    if (!instance) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }

    const { instance: updated, event } = instance.addWatchDir(command.label);
    if (!event) {
      return { added: false }; // duplicate label: nothing to persist, nothing to render
    }
    await instances.save(updated);
    return { added: true };
  }
}
