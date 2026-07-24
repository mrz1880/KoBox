import type { Label } from '../../domain/torrent/Label.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { RenderRtorrentConfig } from './RenderRtorrentConfig.js';
import { TorrentInstanceNotFoundError } from './errors.js';

export interface AddWatchDirCommand {
  readonly username: Username;
  readonly label: Label;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
  readonly render: RenderRtorrentConfig;
}

export class AddWatchDir {
  constructor(private readonly deps: Deps) {}

  async execute(command: AddWatchDirCommand): Promise<void> {
    const { instances, render } = this.deps;

    const instance = await instances.findByUsername(command.username);
    if (!instance) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }

    const { instance: updated, event } = instance.addWatchDir(command.label);
    if (!event) {
      return; // duplicate label: nothing to persist, nothing to render
    }
    await instances.save(updated);
    await render.execute({ username: command.username });
  }
}
