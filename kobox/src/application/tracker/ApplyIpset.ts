import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { BlocklistCachePort, IpsetPort } from '../../domain/tracker/ports.js';
import { renderIpsetRestore } from '../../domain/tracker/rendering.js';

export interface ApplyIpsetReport {
  readonly applied: boolean;
  readonly entries: number;
  readonly reason?: string;
}

interface Deps {
  readonly cache: BlocklistCachePort;
  readonly files: ManagedFilesPort;
  readonly ipset: IpsetPort;
}

// pgl successor (Phase 5): load the merged blocklist cache into the kernel
// set. Renders first (the boot oneshot replays the file after reboot), then
// swaps the live set atomically. A host without ip_set support skips
// honestly — rtorrent-side ipv4_filter enforcement keeps working regardless.
export class ApplyIpset {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<ApplyIpsetReport> {
    const { cache, files, ipset } = this.deps;
    const ranges = await cache.read();
    const file = renderIpsetRestore(ranges);
    const entries = file.content.split('\n').filter((line) => line.startsWith('add ')).length;
    await files.apply([file]);
    if (!(await ipset.ensureBlocklistSet())) {
      return {
        applied: false,
        entries,
        reason: 'ipset unavailable (no binary or kernel ip_set support) — file rendered only',
      };
    }
    await ipset.restore(file.path);
    return { applied: true, entries };
  }
}
