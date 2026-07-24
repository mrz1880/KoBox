import { Blocklist } from '../../domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../domain/tracker/BlocklistUrl.js';
import type { BlocklistRepository, IblocklistCatalogPort } from '../../domain/tracker/ports.js';

export interface CatalogImportReport {
  readonly imported: number;
  readonly total: number;
}

interface Deps {
  readonly catalog: IblocklistCatalogPort;
  readonly blocklists: BlocklistRepository;
}

// The legacy curated enable set (funcs_PeerGuardian): protective lists and
// the countries that pursue torrenting, enabled on FIRST import only —
// operator toggles always win on re-import.
const CURATED_ENABLED = new Set([
  'cruzit',
  'malc0de',
  'zeus',
  'badpeers',
  'level1',
  'level2',
  'microsoft',
  'rangetest',
  'pedophiles',
  'china',
  'russia',
  'australia',
  'united states',
  'portugal',
  'italy',
  'south africa',
  'malaysia',
  'latvia',
  'germany',
  'japan',
  'united kingdom',
  'finland',
  'united arab emirates',
]);

export class ImportBlocklistCatalog {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<CatalogImportReport> {
    const { catalog, blocklists } = this.deps;
    const entries = await catalog.fetchCatalog();
    const source = BlocklistSource.parse('iblocklist');
    let imported = 0;
    for (const entry of entries) {
      if (entry.name.toLowerCase() === 'p2p allow') {
        continue; // incompatible with the PGL allow-list model (legacy rule)
      }
      const url = BlocklistUrl.parse(entry.url);
      const existing = await blocklists.findBySourceAuthorName(source, entry.author, entry.name);
      if (existing) {
        await blocklists.save(
          Blocklist.restore({
            source,
            author: entry.author,
            name: entry.name,
            url,
            subscription: entry.subscription,
            enabled: existing.enabled,
            ...(existing.lastUpdate !== undefined && { lastUpdate: existing.lastUpdate }),
            ...(existing.sha256 !== undefined && { sha256: existing.sha256 }),
          }),
        );
      } else {
        await blocklists.save(
          Blocklist.create({
            source,
            author: entry.author,
            name: entry.name,
            url,
            subscription: entry.subscription,
            enabled: !entry.subscription && CURATED_ENABLED.has(entry.name.toLowerCase()),
          }),
        );
      }
      imported += 1;
    }
    return { imported, total: entries.length };
  }
}
