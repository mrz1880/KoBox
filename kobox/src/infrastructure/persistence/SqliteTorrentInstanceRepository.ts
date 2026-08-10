import { eq } from 'drizzle-orm';
import { Label } from '../../domain/torrent/Label.js';
import { TorrentInstance } from '../../domain/torrent/TorrentInstance.js';
import { SyncMode } from '../../domain/torrent/SyncMode.js';
import { WatchDir } from '../../domain/torrent/WatchDir.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import { RtorrentPort, ScgiPort } from '../../domain/user/Port.js';
import { Username } from '../../domain/user/Username.js';
import type { KoboxDatabase } from './db.js';
import { torrentInstances, watchDirs } from './schema.js';

export class SqliteTorrentInstanceRepository implements TorrentInstanceRepository {
  constructor(private readonly db: KoboxDatabase) {}

  findByUsername(username: Username): Promise<TorrentInstance | undefined> {
    const row = this.db.orm
      .select()
      .from(torrentInstances)
      .where(eq(torrentInstances.username, username.value))
      .get();
    if (!row) {
      return Promise.resolve(undefined);
    }
    const labels = this.db.orm
      .select()
      .from(watchDirs)
      .where(eq(watchDirs.instanceId, row.id))
      .all()
      .sort((left, right) => left.label.localeCompare(right.label));
    return Promise.resolve(
      TorrentInstance.restore({
        username: Username.parse(row.username),
        scgiPort: ScgiPort.parse(row.scgiPort),
        rtorrentPort: RtorrentPort.parse(row.rtorrentPort),
        watchDirs: [
          WatchDir.root(),
          ...labels.map((dirRow) =>
            WatchDir.labeled(Label.parse(dirRow.label), SyncMode.parse(dirRow.syncMode)),
          ),
        ],
        allowPublicTracker: row.allowPublicTracker === 1,
        syncDisabled: row.syncDisabled === 1,
      }),
    );
  }

  save(instance: TorrentInstance): Promise<void> {
    this.db.orm.transaction((tx) => {
      const values = {
        username: instance.username.value,
        scgiPort: instance.scgiPort.value,
        rtorrentPort: instance.rtorrentPort.value,
        allowPublicTracker: instance.allowPublicTracker ? 1 : 0,
        syncDisabled: instance.syncDisabled ? 1 : 0,
      };
      const saved = tx
        .insert(torrentInstances)
        .values(values)
        .onConflictDoUpdate({ target: torrentInstances.username, set: values })
        .returning({ id: torrentInstances.id })
        .get();
      // watch dirs are value objects of the aggregate: replace wholesale
      tx.delete(watchDirs).where(eq(watchDirs.instanceId, saved.id)).run();
      const labelled = instance.watchDirs.filter((dir) => dir.label !== undefined);
      if (labelled.length > 0) {
        tx.insert(watchDirs)
          .values(
            labelled.map((dir) => ({
              instanceId: saved.id,
              label: dir.label?.value ?? '',
              syncMode: dir.syncMode.value,
            })),
          )
          .run();
      }
    });
    return Promise.resolve();
  }

  delete(username: Username): Promise<void> {
    // watch_dirs rows go with the instance via ON DELETE CASCADE
    this.db.orm.delete(torrentInstances).where(eq(torrentInstances.username, username.value)).run();
    return Promise.resolve();
  }
}
