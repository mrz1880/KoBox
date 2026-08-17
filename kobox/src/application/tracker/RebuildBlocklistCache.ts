import { mergeBlocklistRanges } from '../../domain/tracker/rendering.js';
import type { BlocklistCachePort, BlocklistRepository } from '../../domain/tracker/ports.js';

interface Deps {
  readonly blocklists: BlocklistRepository;
  readonly cache: BlocklistCachePort;
}

// Rebuilds the merged range cache from what is already on disk for the lists
// that are currently enabled. This is what makes a toggle take effect: the
// filter rtorrent reads is rendered from the merged cache, so re-rendering
// alone would keep a disabled list's ranges. Re-running the full update would
// also work and would re-download every remaining list, which on a box carrying
// three hundred of them costs minutes for a decision that costs a tick.
//
// A list with no cached content yet contributes nothing until the next update
// pass fetches it. That is the honest answer: KoBox has never seen its ranges.
export class RebuildBlocklistCache {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const enabled = await this.deps.blocklists.listEnabled();
    const cached: (readonly string[])[] = [];
    for (const list of enabled) {
      const ranges = await this.deps.cache.readList(list.fileStem);
      if (ranges !== undefined) {
        cached.push(ranges);
      }
    }
    await this.deps.cache.write(mergeBlocklistRanges(cached));
  }
}
