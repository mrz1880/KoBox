import type { Label } from '../../domain/torrent/Label.js';
import type { TorrentInstanceRepository, WatchDirPort } from '../../domain/torrent/ports.js';
import type { TorrentInstance } from '../../domain/torrent/TorrentInstance.js';
import { WatchDir } from '../../domain/torrent/WatchDir.js';
import type { Username } from '../../domain/user/Username.js';
import { TorrentInstanceNotFoundError } from './errors.js';

interface Deps {
  readonly instances: TorrentInstanceRepository;
  readonly watchDirs: WatchDirPort;
}

// Whether the folder changed, so the caller knows a render is due. A folder
// holding anything stays as it is: its downloads seed from its path, and moving
// them under a seeding torrent is not something to do behind its back.
export interface ReshapeWatchDirReport {
  readonly changed: boolean;
}

// The new name's directories are laid out by the render that follows, as for a
// folder just added; the old ones go only when they hold nothing.
async function reshape(
  deps: Deps,
  username: Username,
  label: Label,
  next: (instance: TorrentInstance) => TorrentInstance,
): Promise<ReshapeWatchDirReport> {
  const instance = await deps.instances.findByUsername(username);
  if (!instance) {
    throw new TorrentInstanceNotFoundError(username.value);
  }
  // decided before the disk is touched: a name already taken refuses here
  const updated = next(instance);
  if (updated === instance) {
    return { changed: false };
  }
  if (!(await deps.watchDirs.removeIfEmpty(username, WatchDir.labeled(label)))) {
    return { changed: false };
  }
  await deps.instances.save(updated);
  return { changed: true };
}

export interface RemoveWatchDirCommand {
  readonly username: Username;
  readonly label: Label;
}

export class RemoveWatchDir {
  constructor(private readonly deps: Deps) {}

  execute(command: RemoveWatchDirCommand): Promise<ReshapeWatchDirReport> {
    return reshape(this.deps, command.username, command.label, (instance) =>
      instance.removeWatchDir(command.label),
    );
  }
}

export interface RenameWatchDirCommand {
  readonly username: Username;
  readonly label: Label;
  readonly to: Label;
}

export class RenameWatchDir {
  constructor(private readonly deps: Deps) {}

  execute(command: RenameWatchDirCommand): Promise<ReshapeWatchDirReport> {
    return reshape(this.deps, command.username, command.label, (instance) =>
      instance.renameWatchDir(command.label, command.to),
    );
  }
}
