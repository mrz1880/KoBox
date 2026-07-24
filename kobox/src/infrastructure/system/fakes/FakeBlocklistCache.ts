import type { BlocklistCachePort } from '../../../domain/tracker/ports.js';

export class FakeBlocklistCache implements BlocklistCachePort {
  stored: readonly string[] = [];
  readonly perList = new Map<string, readonly string[]>();

  write(ranges: readonly string[]): Promise<void> {
    this.stored = ranges;
    return Promise.resolve();
  }

  read(): Promise<readonly string[]> {
    return Promise.resolve(this.stored);
  }

  writeList(stem: string, ranges: readonly string[]): Promise<void> {
    this.perList.set(stem, ranges);
    return Promise.resolve();
  }

  readList(stem: string): Promise<readonly string[] | undefined> {
    return Promise.resolve(this.perList.get(stem));
  }
}
