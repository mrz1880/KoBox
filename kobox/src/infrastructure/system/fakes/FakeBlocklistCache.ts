import type { BlocklistCachePort } from '../../../domain/tracker/ports.js';

export class FakeBlocklistCache implements BlocklistCachePort {
  stored: readonly string[] = [];

  write(ranges: readonly string[]): Promise<void> {
    this.stored = ranges;
    return Promise.resolve();
  }

  read(): Promise<readonly string[]> {
    return Promise.resolve(this.stored);
  }
}
