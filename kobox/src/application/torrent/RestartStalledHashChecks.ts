import { messageOf } from '../../domain/shared/errorMessage.js';
import { HashQueue } from '../../domain/torrent/HashQueue.js';
import type { InfoHash } from '../../domain/torrent/InfoHash.js';
import type {
  HashQueuePort,
  StalledHashCheckRepository,
  TorrentInstanceRepository,
} from '../../domain/torrent/ports.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly users: Pick<UserRepository, 'listAll'>;
  readonly instances: Pick<TorrentInstanceRepository, 'findByUsername'>;
  readonly hashQueue: HashQueuePort;
  readonly stalls: StalledHashCheckRepository;
}

export interface RestartedDownload {
  readonly username: Username;
  readonly infoHash: InfoHash;
}

// A member whose rTorrent could not be asked: their queue is looked at again
// next pass, and the operator is told why it was not this time.
export interface UnreadableHashQueue {
  readonly username: Username;
  readonly error: string;
}

export interface StalledHashCheckPass {
  readonly restarted: readonly RestartedDownload[];
  readonly unreadable: readonly UnreadableHashQueue[];
}

// Restarts, in each member's rTorrent, a download left waiting in a hash
// queue where nothing is checked (see HashQueue), once seen stalled at two
// passes in a row: what a member otherwise does by hand from ruTorrent. One
// member's rTorrent not answering costs no other member their pass.
export class RestartStalledHashChecks {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<StalledHashCheckPass> {
    const restarted: RestartedDownload[] = [];
    const unreadable: UnreadableHashQueue[] = [];
    for (const user of await this.deps.users.listAll()) {
      const instance = await this.deps.instances.findByUsername(user.username);
      if (instance === undefined) {
        continue;
      }
      try {
        const queue = HashQueue.of(await this.deps.hashQueue.read(instance.scgiPort));
        const verdict = queue.verdictAfter(await this.deps.stalls.find(user.username));
        for (const infoHash of verdict.restart) {
          await this.deps.hashQueue.restart(instance.scgiPort, infoHash);
          restarted.push({ username: user.username, infoHash });
        }
        // a download just restarted has to look stalled twice again
        await this.deps.stalls.replace(user.username, verdict.watch);
      } catch (error) {
        unreadable.push({ username: user.username, error: messageOf(error) });
      }
    }
    return { restarted, unreadable };
  }
}
