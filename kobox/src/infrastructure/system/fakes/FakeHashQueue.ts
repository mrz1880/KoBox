import type { HashQueueEntry } from '../../../domain/torrent/HashQueue.js';
import type { InfoHash } from '../../../domain/torrent/InfoHash.js';
import type { HashQueuePort } from '../../../domain/torrent/ports.js';
import type { ScgiPort } from '../../../domain/user/Port.js';

export interface RestartCall {
  readonly scgiPort: number;
  readonly infoHash: string;
}

// Each member's hash queue as a test sets it; an rTorrent never set holds
// nothing in its queue.
export class FakeHashQueue implements HashQueuePort {
  readonly restarted: RestartCall[] = [];
  private readonly queues = new Map<number, readonly HashQueueEntry[]>();
  private readonly failures = new Map<number, Error>();

  holds(scgiPort: number, entries: readonly HashQueueEntry[]): void {
    this.queues.set(scgiPort, entries);
  }

  silent(scgiPort: number, error: Error): void {
    this.failures.set(scgiPort, error);
  }

  read(scgiPort: ScgiPort): Promise<readonly HashQueueEntry[]> {
    const failure = this.failures.get(scgiPort.value);
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    return Promise.resolve(this.queues.get(scgiPort.value) ?? []);
  }

  restart(scgiPort: ScgiPort, infoHash: InfoHash): Promise<void> {
    this.restarted.push({ scgiPort: scgiPort.value, infoHash: infoHash.value });
    return Promise.resolve();
  }
}
