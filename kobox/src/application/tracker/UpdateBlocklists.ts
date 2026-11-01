import type { StuckBlocklist } from '../../domain/tracker/events.js';
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

export interface BlocklistFailure {
  readonly author: string;
  readonly name: string;
  readonly reason: string;
}

export interface BlocklistUpdateReport {
  readonly updated: number;
  readonly failures: readonly BlocklistFailure[]; // this run's, for the log
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
// failing list (expired subscription, dead mirror) is recorded and SKIPPED:
// the remaining lists still refresh and old data is never destroyed. An admin
// hears of it only once a list has failed for a day, in one message for all.
export class UpdateBlocklists {
  constructor(private readonly deps: Deps) {}

  async execute(command: UpdateBlocklistsCommand): Promise<BlocklistUpdateReport> {
    const { blocklists, download, notifications, cache, credentials } = this.deps;
    const enabled = await blocklists.listEnabled();
    const downloaded: (readonly string[])[] = [];
    let updated = 0;
    const failures: BlocklistFailure[] = [];
    const stuck: StuckBlocklist[] = [];
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
      if ('ranges' in fetched) {
        downloaded.push(fetched.ranges);
        await cache.writeList(list.fileStem, fetched.ranges);
        await blocklists.save(list.recordSuccess(command.now, fetched.sha256));
        updated += 1;
        continue;
      }
      // issue #117, both halves: the other lists keep updating AND this
      // list's last good ranges stay in the merge
      const lastGood = await cache.readList(list.fileStem);
      if (lastGood !== undefined) {
        downloaded.push(lastGood);
      }
      failures.push({ author: list.author, name: list.name, reason: fetched.failure });
      const failing = list.recordFailure(command.now);
      if (!failing.overdueAt(command.now)) {
        await blocklists.save(failing);
        continue;
      }
      await blocklists.save(failing.markReported());
      stuck.push({
        author: list.author,
        name: list.name,
        since: failing.lastUpdate?.status === 'failed' ? failing.lastUpdate.since : command.now,
        reason: fetched.failure,
      });
    }

    // one message for every list that just went a day without updating
    if (stuck.length > 0) {
      await notifications.notify({ type: 'BlocklistsNotUpdating', lists: stuck });
    }

    if (updated === 0) {
      return { updated, failures, skipped };
    }
    const ranges = mergeBlocklistRanges(downloaded);
    await cache.write(ranges);
    return { updated, failures, skipped, ranges };
  }
}
