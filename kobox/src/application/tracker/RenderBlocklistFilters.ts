import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { BlocklistCachePort } from '../../domain/tracker/ports.js';
import {
  renderUserBlocklistDropin,
  renderUserBlocklistFile,
} from '../../domain/tracker/rendering.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { UserRepository } from '../../domain/user/ports.js';

export interface RenderBlocklistFiltersCommand {
  readonly username?: Username; // absent = every provisioned user
}

export interface BlocklistFiltersReport {
  readonly changedFiles: readonly string[];
}

interface Deps {
  readonly users: UserRepository;
  readonly instances: TorrentInstanceRepository;
  readonly files: ManagedFilesPort;
  readonly cache: BlocklistCachePort;
}

// Renders each user's filter file + rtorrent drop-in from the merged cache.
// No restart: the drop-in schedules a daily ipv4_filter reload, and a fresh
// instance picks the filter up at start.
export class RenderBlocklistFilters {
  constructor(private readonly deps: Deps) {}

  async execute(command: RenderBlocklistFiltersCommand): Promise<BlocklistFiltersReport> {
    const { users, instances, files, cache } = this.deps;
    const ranges = await cache.read();
    const targets =
      command.username !== undefined
        ? [command.username]
        : (await users.listAll()).map((user) => user.username);

    const changedFiles: string[] = [];
    for (const username of targets) {
      const instance = await instances.findByUsername(username);
      if (!instance) {
        continue; // no rtorrent instance yet — nothing to filter
      }
      const changed = await files.apply([
        renderUserBlocklistFile(username, ranges),
        renderUserBlocklistDropin(username, ranges.length > 0),
      ]);
      changedFiles.push(...changed);
    }
    return { changedFiles };
  }
}
