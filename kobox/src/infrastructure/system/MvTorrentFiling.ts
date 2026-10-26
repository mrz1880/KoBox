import type { TorrentFilingPort } from '../../domain/torrent/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// A plain move inside the member's own tree: the file keeps its owner and the
// member's group (watch is setgid). -n, so a .torrent already filed under the
// same name is never replaced; the new one then simply stays in watch.
export class MvTorrentFiling implements TorrentFilingPort {
  constructor(private readonly runner: CommandRunner) {}

  async file(torrentFile: string, folder: string): Promise<void> {
    await runOrThrow(this.runner, { command: 'mv', args: ['-n', '--', torrentFile, `${folder}/`] });
  }
}
