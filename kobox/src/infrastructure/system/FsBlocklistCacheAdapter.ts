import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BlocklistCachePort } from '../../domain/tracker/ports.js';

const DEFAULT_PATH = '/var/lib/kobox/blocklists/blocklist_rtorrent.txt';

export class FsBlocklistCacheAdapter implements BlocklistCachePort {
  constructor(private readonly path = DEFAULT_PATH) {}

  write(ranges: readonly string[]): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.kobox-tmp`;
    writeFileSync(temp, `${ranges.join('\n')}\n`);
    renameSync(temp, this.path);
    return Promise.resolve();
  }

  read(): Promise<readonly string[]> {
    if (!existsSync(this.path)) {
      return Promise.resolve([]);
    }
    const lines = readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    return Promise.resolve(lines);
  }
}
