import type { FinishedTorrent } from '../../../domain/space/FinishedTorrent.js';
import type { MemberTorrentsPort } from '../../../domain/space/ports.js';
import type { InfoHash } from '../../../domain/torrent/InfoHash.js';
import type { ScgiPort } from '../../../domain/user/Port.js';

// The finished torrents of each member's rTorrent, keyed by its SCGI port as
// the real one is reached. Erasing drops a torrent from the list.
export class FakeMemberTorrents implements MemberTorrentsPort {
  private readonly torrents = new Map<number, FinishedTorrent[]>();
  private readonly unreachable = new Set<number>();
  private readonly refusingErase = new Set<string>();
  readonly erased: string[] = [];

  holds(scgiPort: ScgiPort, torrents: readonly FinishedTorrent[]): void {
    this.torrents.set(scgiPort.value, [...torrents]);
  }

  goesDown(scgiPort: ScgiPort): void {
    this.unreachable.add(scgiPort.value);
  }

  refusesToErase(infoHash: InfoHash): void {
    this.refusingErase.add(infoHash.value);
  }

  listFinished(scgiPort: ScgiPort): Promise<readonly FinishedTorrent[]> {
    if (this.unreachable.has(scgiPort.value)) {
      return Promise.reject(new Error(`rtorrent SCGI on ${String(scgiPort.value)} does not answer`));
    }
    return Promise.resolve(this.torrents.get(scgiPort.value) ?? []);
  }

  erase(scgiPort: ScgiPort, infoHash: InfoHash): Promise<void> {
    if (this.refusingErase.has(infoHash.value)) {
      return Promise.reject(new Error(`rtorrent returned a fault for d.erase`));
    }
    const left = (this.torrents.get(scgiPort.value) ?? []).filter(
      (torrent) => !torrent.infoHash.equals(infoHash),
    );
    this.torrents.set(scgiPort.value, left);
    this.erased.push(infoHash.value);
    return Promise.resolve();
  }
}
