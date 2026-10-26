import type { RenderedFile } from '../../../domain/shared/files.js';
import type { RutorrentPoolsPort } from '../../../domain/torrent/ports.js';

export class FakeRutorrentPools implements RutorrentPoolsPort {
  converged: readonly RenderedFile[] = [];

  converge(pools: readonly RenderedFile[]): Promise<void> {
    this.converged = pools;
    return Promise.resolve();
  }
}
