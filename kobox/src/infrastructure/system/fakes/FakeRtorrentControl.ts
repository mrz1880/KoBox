import type { InfoHash } from '../../../domain/torrent/InfoHash.js';
import type { RtorrentControlPort } from '../../../domain/torrent/ports.js';
import type { ScgiPort } from '../../../domain/user/Port.js';

export interface ControlCall {
  readonly scgiPort: number;
  readonly infoHash: string;
}

export class FakeRtorrentControl implements RtorrentControlPort {
  readonly stopped: ControlCall[] = [];
  readonly started: ControlCall[] = [];
  failWith: Error | undefined;

  start(scgiPort: ScgiPort, infoHash: InfoHash): Promise<void> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    this.started.push({ scgiPort: scgiPort.value, infoHash: infoHash.value });
    return Promise.resolve();
  }

  stopAndClose(scgiPort: ScgiPort, infoHash: InfoHash): Promise<void> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    this.stopped.push({ scgiPort: scgiPort.value, infoHash: infoHash.value });
    return Promise.resolve();
  }
}
