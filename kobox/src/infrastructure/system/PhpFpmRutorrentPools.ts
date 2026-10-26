import { PHP_FPM, RUTORRENT_POOL_DIR, RUTORRENT_POOL_PREFIX } from '../../domain/installation/platform.js';
import type { ManagedFilesPort, RenderedFile } from '../../domain/shared/files.js';
import type { RutorrentPoolsPort } from '../../domain/torrent/ports.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

// Writes the member pools, removes the pool of anyone no longer listed, and
// reloads PHP only once php-fpm -t accepts the whole configuration: a reload
// with a broken pool would stop PHP for Nextcloud as well.
export class PhpFpmRutorrentPools implements RutorrentPoolsPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly files: ManagedFilesPort,
  ) {}

  async converge(pools: readonly RenderedFile[]): Promise<void> {
    const changed = await this.files.apply(pools);
    const wanted = new Set(pools.map((pool) => pool.path));
    const listed = await runOrThrow(this.runner, {
      command: 'find',
      args: [RUTORRENT_POOL_DIR, '-maxdepth', '1', '-name', `${RUTORRENT_POOL_PREFIX}*.conf`],
    });
    const stale = listed.stdout
      .split('\n')
      .filter((path) => path !== '' && !wanted.has(path));
    for (const path of stale) {
      await runOrThrow(this.runner, { command: 'rm', args: ['-f', '--', path] });
    }
    if (changed.length === 0 && stale.length === 0) {
      return;
    }
    await runOrThrow(this.runner, { command: PHP_FPM.binary, args: ['-t'] });
    await runOrThrow(this.runner, { command: 'systemctl', args: ['reload', PHP_FPM.unit] });
  }
}
