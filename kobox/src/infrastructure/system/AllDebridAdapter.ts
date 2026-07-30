import { alldebridUnlockSchema } from '../../application/ddl/debridSchemas.js';
import { DirectUrl } from '../../domain/ddl/DirectUrl.js';
import type { FilehosterLink } from '../../domain/ddl/FilehosterLink.js';
import type { DebridPort, DebridResult } from '../../domain/ddl/ports.js';

export class DebridError extends Error {
  constructor(code: string, message: string) {
    super(`debrid error ${code}: ${message}`);
    this.name = 'DebridError';
  }
}

type FetchFn = (url: string) => Promise<{ json(): Promise<unknown> }>;

const DEFAULT_BASE_URL = 'https://api.alldebrid.com';

// Unlocks a filehoster link via AllDebrid v4. The api key is passed as a query
// param; the request URL therefore CARRIES A SECRET and must never be logged —
// a network failure is re-thrown sanitized so the key can't leak into the
// worker's job-error log.
export class AllDebridAdapter implements DebridPort {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async unlock(link: FilehosterLink): Promise<DebridResult> {
    const url = new URL(`${this.baseUrl}/v4/link/unlock`);
    url.searchParams.set('agent', 'kobox');
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('link', link.value);

    let body: unknown;
    try {
      const response = await this.fetchFn(url.toString());
      body = await response.json();
    } catch {
      throw new DebridError('network', 'debrid request failed');
    }

    const parsed = alldebridUnlockSchema.parse(body);
    if (parsed.status === 'error') {
      throw new DebridError(parsed.error.code, parsed.error.message);
    }
    return {
      direct: DirectUrl.parse(parsed.data.link),
      ...(parsed.data.filename !== undefined && { filename: parsed.data.filename }),
    };
  }
}
