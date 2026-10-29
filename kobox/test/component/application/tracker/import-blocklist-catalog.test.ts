import { beforeEach, describe, expect, it } from 'vitest';
import { ImportBlocklistCatalog } from '../../../../src/application/tracker/ImportBlocklistCatalog.js';
import type { Blocklist } from '../../../../src/domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../../../src/domain/tracker/BlocklistSource.js';
import type { CatalogEntry } from '../../../../src/domain/tracker/ports.js';
import { InMemoryBlocklistRepository } from '../../../../src/infrastructure/persistence/InMemoryBlocklistRepository.js';
import { FakeIblocklistCatalog } from '../../../../src/infrastructure/system/fakes/FakeIblocklistCatalog.js';

const AUTHOR = 'Example Org';
const iblocklist = BlocklistSource.parse('iblocklist');

// The legacy funcs_PeerGuardian enable set, as the catalog spells the names.
const CURATED = [
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
] as const;

let blocklists: InMemoryBlocklistRepository;

beforeEach(() => {
  blocklists = new InMemoryBlocklistRepository();
});

function entry(name: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    name,
    author: AUTHOR,
    listId: name,
    url: `https://lists.example.org/${encodeURIComponent(name)}`,
    subscription: false,
    ...overrides,
  };
}

async function importCatalog(entries: readonly CatalogEntry[]): Promise<{
  imported: number;
  total: number;
}> {
  return new ImportBlocklistCatalog({
    catalog: new FakeIblocklistCatalog(entries),
    blocklists,
  }).execute();
}

async function stored(name: string): Promise<Blocklist | undefined> {
  return blocklists.findBySourceAuthorName(iblocklist, AUTHOR, name);
}

describe('ImportBlocklistCatalog', () => {
  it('should_enable_every_list_of_the_legacy_curated_set_on_first_import', async () => {
    await importCatalog(CURATED.map((name) => entry(name)));

    for (const name of CURATED) {
      expect({ name, enabled: (await stored(name))?.enabled }).toEqual({ name, enabled: true });
    }
  });

  it('should_recognise_a_curated_list_whatever_its_case', async () => {
    await importCatalog([entry('Level1'), entry('United States')]);

    expect((await stored('Level1'))?.enabled).toBe(true);
    expect((await stored('United States'))?.enabled).toBe(true);
  });

  it('should_never_enable_a_curated_list_that_needs_a_subscription', async () => {
    await importCatalog([entry('level1', { subscription: true })]);

    expect((await stored('level1'))?.enabled).toBe(false);
  });

  it('should_skip_the_allow_list_whatever_its_case_and_count_it_in_the_total', async () => {
    const report = await importCatalog([entry('p2p allow'), entry('P2P Allow'), entry('obscure')]);

    expect(report).toEqual({ imported: 1, total: 3 });
    expect(await stored('p2p allow')).toBeUndefined();
    expect(await stored('P2P Allow')).toBeUndefined();
  });

  it('should_store_imported_lists_under_the_iblocklist_source_with_their_url', async () => {
    await importCatalog([entry('obscure')]);

    const list = await stored('obscure');
    expect(list?.url.value).toBe('https://lists.example.org/obscure');
    expect(list?.subscription).toBe(false);
  });

  it('should_refresh_the_url_and_subscription_but_keep_the_update_history_on_reimport', async () => {
    await importCatalog([entry('level1')]);
    const first = await stored('level1');
    await blocklists.save(first!.recordSuccess('2026-07-24 10:00:00', 'abc123'));

    const report = await importCatalog([
      entry('level1', { url: 'https://mirror.example.org/level1', subscription: true }),
    ]);

    const after = await stored('level1');
    expect(report).toEqual({ imported: 1, total: 1 });
    expect(after?.url.value).toBe('https://mirror.example.org/level1');
    expect(after?.subscription).toBe(true);
    expect(after?.enabled).toBe(true);
    expect(after?.lastUpdate).toEqual({ status: 'ok', at: '2026-07-24 10:00:00' });
    expect(after?.sha256).toBe('abc123');
  });

  it('should_keep_a_never_updated_list_without_history_on_reimport', async () => {
    await importCatalog([entry('obscure')]);
    await importCatalog([entry('obscure')]);

    const after = await stored('obscure');
    expect(after?.lastUpdate).toBeUndefined();
    expect(after?.sha256).toBeUndefined();
  });
});
