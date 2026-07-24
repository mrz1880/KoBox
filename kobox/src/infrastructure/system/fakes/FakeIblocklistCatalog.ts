import type { CatalogEntry, IblocklistCatalogPort } from '../../../domain/tracker/ports.js';

export class FakeIblocklistCatalog implements IblocklistCatalogPort {
  constructor(private readonly entries: readonly CatalogEntry[]) {}

  fetchCatalog(): Promise<readonly CatalogEntry[]> {
    return Promise.resolve(this.entries);
  }
}
