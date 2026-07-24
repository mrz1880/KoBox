import type { Blocklist } from '../../domain/tracker/Blocklist.js';
import type { BlocklistSource } from '../../domain/tracker/BlocklistSource.js';
import type { BlocklistRepository } from '../../domain/tracker/ports.js';

function keyOf(source: string, author: string, name: string): string {
  return `${source}|${author}|${name}`;
}

export class InMemoryBlocklistRepository implements BlocklistRepository {
  private readonly byKey = new Map<string, Blocklist>();

  listAll(): Promise<readonly Blocklist[]> {
    return Promise.resolve([...this.byKey.values()]);
  }

  async listEnabled(): Promise<readonly Blocklist[]> {
    return (await this.listAll()).filter((blocklist) => blocklist.enabled);
  }

  findBySourceAuthorName(
    source: BlocklistSource,
    author: string,
    name: string,
  ): Promise<Blocklist | undefined> {
    return Promise.resolve(this.byKey.get(keyOf(source.value, author, name)));
  }

  save(blocklist: Blocklist): Promise<Blocklist> {
    this.byKey.set(keyOf(blocklist.source.value, blocklist.author, blocklist.name), blocklist);
    return Promise.resolve(blocklist);
  }
}
