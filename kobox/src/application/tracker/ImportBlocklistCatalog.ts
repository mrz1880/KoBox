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

// The protective lists enabled on FIRST import only; operator toggles always
// win on re-import. MySB (funcs_PeerGuardian) also enabled whole countries said
// to pursue torrenting: on a real box they cut off most peers (seedboxes in
// Germany, Finland, the United States, the United Kingdom) for little
// protection, the monitoring firms being in level1 already.
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
