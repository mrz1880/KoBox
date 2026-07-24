import { mergeBlocklistRanges } from '../../domain/tracker/rendering.js';
import type {
  BlocklistCachePort,
  BlocklistDownloadPort,
  BlocklistRepository,
  TrackerNotificationPort,
} from '../../domain/tracker/ports.js';

export interface UpdateBlocklistsCommand {
  readonly now: string; // YYYY-MM-DD HH:MM:SS
}

export interface BlocklistUpdateReport {
  readonly updated: number;
  readonly failed: number;
  readonly skipped: number; // subscription lists left alone for lack of credentials
  // undefined = every download failed: the previous cache stays authoritative
  readonly ranges?: readonly string[];
}

export interface IblocklistCredentials {
  readonly username: string;
  readonly pin: string;
}

interface Deps {
  readonly blocklists: BlocklistRepository;
  readonly download: BlocklistDownloadPort;
  readonly notifications: TrackerNotificationPort;
  readonly cache: BlocklistCachePort;
  // From the environment, never from the DB or logs (secret material).
  readonly credentials?: IblocklistCredentials;
}

// §5.6 + issue #117 closure: every download is TLS+integrity verified, and a
// failing list (expired subscription, dead mirror) is recorded, notified and
// SKIPPED — the remaining lists still refresh and old data is never destroyed.
export class UpdateBlocklists {
  constructor(private readonly deps: Deps) {}

  async execute(command: UpdateBlocklistsCommand): Promise<BlocklistUpdateReport> {
    const { blocklists, download, notifications, cache, credentials } = this.deps;
    const enabled = await blocklists.listEnabled();
    const downloaded: (readonly string[])[] = [];
    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const list of enabled) {
      if (list.subscription && !credentials) {
        // guaranteed 4xx without credentials: skip quietly instead of a
        // failure notification on every run
        skipped += 1;
        continue;
      }
      const url =
        list.subscription && credentials
          ? list.url.withCredentials(credentials.username, credentials.pin)
          : list.url.value;
      const fetched = await download.fetch(url);
      if (fetched) {
        downloaded.push(fetched.ranges);
        await cache.writeList(list.fileStem, fetched.ranges);
        await blocklists.save(list.recordSuccess(command.now, fetched.sha256));
        updated += 1;
      } else {
        // issue #117, both halves: the other lists keep updating AND this
        // list's last good ranges stay in the merge
        const lastGood = await cache.readList(list.fileStem);
        if (lastGood !== undefined) {
          downloaded.push(lastGood);
        }
        await blocklists.save(list.recordFailure());
        await notifications.notify({
          type: 'BlocklistUpdateFailed',
          author: list.author,
          name: list.name,
        });
        failed += 1;
      }
    }

    if (updated === 0) {
      return { updated, failed, skipped };
    }
    const ranges = mergeBlocklistRanges(downloaded);
    await cache.write(ranges);
    return { updated, failed, skipped, ranges };
  }
}
