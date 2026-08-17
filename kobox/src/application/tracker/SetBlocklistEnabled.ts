import type { BlocklistSource } from '../../domain/tracker/BlocklistSource.js';
import type { BlocklistRepository } from '../../domain/tracker/ports.js';
import { BlocklistNotFoundError } from './errors.js';

export interface SetBlocklistEnabledCommand {
  readonly source: BlocklistSource;
  readonly author: string;
  readonly name: string;
  readonly enabled: boolean;
}

interface Deps {
  readonly blocklists: BlocklistRepository;
}

// Turns one list on or off. Blocklist.enable/disable existed since the tracker
// phase with no caller, so the admin page could only report the state it found.
export class SetBlocklistEnabled {
  constructor(private readonly deps: Deps) {}

  async execute(command: SetBlocklistEnabledCommand): Promise<void> {
    const found = await this.deps.blocklists.findBySourceAuthorName(
      command.source,
      command.author,
      command.name,
    );
    if (found === undefined) {
      throw new BlocklistNotFoundError(command.author, command.name);
    }
    await this.deps.blocklists.save(command.enabled ? found.enable() : found.disable());
  }
}
