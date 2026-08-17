import { basename, join } from 'node:path';
import type { RecyclingMode } from '../../domain/torrent/RecyclingMode.js';
import type { ContentRecyclerPort } from '../../domain/torrent/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// `cp -a` keeps mode, ownership and timestamps so the copy is indistinguishable
// from a finished download; `-l` makes it hard links instead of bytes. The
// legacy box used exactly these two, and rtorrent's hash check is what decides
// whether the result is usable, so a wrong copy costs a re-download and not a
// corrupt torrent.
export class ContentRecyclerAdapter implements ContentRecyclerPort {
  constructor(private readonly runner: CommandRunner) {}

  async replicate(source: string, targetDir: string, mode: RecyclingMode): Promise<void> {
    if (!mode.reusesExistingContent) {
      return;
    }
    const target = join(targetDir, basename(source));
    await runOrThrow(this.runner, {
      command: 'cp',
      args: mode.sharesInodes ? ['-al', source, target] : ['-a', source, target],
    });
  }
}
