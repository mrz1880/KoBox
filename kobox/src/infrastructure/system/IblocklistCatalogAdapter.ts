import type { CatalogEntry, IblocklistCatalogPort } from '../../domain/tracker/ports.js';
import type { Logger } from '../logging/logger.js';
import {
  HttpsBlocklistDownloadAdapter,
  type HttpsDownloadOptions,
} from './HttpsBlocklistDownloadAdapter.js';
import { get, type RequestOptions } from 'node:https';

const DEFAULT_CATALOG_URL = 'https://www.iblocklist.com/lists.xml';

function tagContent(line: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(line);
  return match?.[1];
}

// Minimal line-oriented scan of lists.xml (pretty-printed: outer <list> tags
// alone on their line, inner elements one per line). No XML dependency for a
// single, stable feed; the E2E exercises it against a fixture server.
export function parseIblocklistCatalog(xml: string): readonly CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  let current: { name?: string; author?: string; listId?: string; subscription?: boolean } | undefined;
  for (const rawLine of xml.split('\n')) {
    const line = rawLine.trim();
    if (line === '<list>') {
      current = {};
      continue;
    }
    if (line === '</list>') {
      if (current?.name !== undefined && current.author !== undefined && current.listId !== undefined) {
        entries.push({
          name: current.name,
          author: current.author,
          listId: current.listId,
          url: `https://list.iblocklist.com/?list=${current.listId}&fileformat=p2p&archiveformat=gz`,
          subscription: current.subscription ?? false,
        });
      }
      current = undefined;
      continue;
    }
    if (!current) {
      continue;
    }
    const name = tagContent(line, 'name');
    if (name !== undefined) {
      current.name = name;
    }
    const author = tagContent(line, 'author');
    if (author !== undefined) {
      current.author = author;
    }
    const listId = tagContent(line, 'list');
    if (listId !== undefined) {
      current.listId = listId;
    }
    const subscription = tagContent(line, 'subscription');
    if (subscription !== undefined) {
      current.subscription = subscription === 'true';
    }
  }
  return entries;
}

function httpsGetText(url: string, options: HttpsDownloadOptions): Promise<string | undefined> {
  return new Promise((resolve) => {
    const requestOptions: RequestOptions = options.ca === undefined ? {} : { ca: options.ca };
    const request = get(url, requestOptions, (response) => {
      if ((response.statusCode ?? 0) !== 200) {
        response.resume();
        resolve(undefined);
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      response.on('error', () => {
        resolve(undefined);
      });
    });
    request.on('error', () => {
      resolve(undefined);
    });
    request.setTimeout(30_000, () => {
      request.destroy();
      resolve(undefined);
    });
  });
}

export class IblocklistCatalogAdapter implements IblocklistCatalogPort {
  constructor(
    private readonly logger: Logger,
    private readonly catalogUrl = DEFAULT_CATALOG_URL,
    private readonly options: HttpsDownloadOptions = {},
  ) {}

  async fetchCatalog(): Promise<readonly CatalogEntry[]> {
    const xml = await httpsGetText(this.catalogUrl, this.options);
    if (xml === undefined) {
      this.logger.warn({ url: this.catalogUrl }, 'iblocklist catalog fetch failed');
      return [];
    }
    return parseIblocklistCatalog(xml);
  }
}

// Re-export so composition wires both from one import site.
export { HttpsBlocklistDownloadAdapter };
