import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BlocklistCachePort } from '../../domain/tracker/ports.js';

const DEFAULT_PATH = '/var/lib/kobox/blocklists/blocklist_rtorrent.txt';

function readLines(path: string): readonly string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

function writeAtomic(path: string, ranges: readonly string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.kobox-tmp`;
  writeFileSync(temp, `${ranges.join('\n')}\n`);
  renameSync(temp, path);
}

// Filenames come from Blocklist.fileStem ("<author>#<name>", spaces
// flattened) — no path separators can appear (guarded here regardless).
function sanitizeStem(stem: string): string {
  return stem.replaceAll('/', '_');
}

export class FsBlocklistCacheAdapter implements BlocklistCachePort {
  constructor(private readonly path = DEFAULT_PATH) {}

  private listPath(stem: string): string {
    return join(dirname(this.path), 'lists', `${sanitizeStem(stem)}.txt`);
  }

  write(ranges: readonly string[]): Promise<void> {
    writeAtomic(this.path, ranges);
    return Promise.resolve();
  }

  read(): Promise<readonly string[]> {
    return Promise.resolve(existsSync(this.path) ? readLines(this.path) : []);
  }

  writeList(stem: string, ranges: readonly string[]): Promise<void> {
    writeAtomic(this.listPath(stem), ranges);
    return Promise.resolve();
  }

  readList(stem: string): Promise<readonly string[] | undefined> {
    const path = this.listPath(stem);
    return Promise.resolve(existsSync(path) ? readLines(path) : undefined);
  }
}
