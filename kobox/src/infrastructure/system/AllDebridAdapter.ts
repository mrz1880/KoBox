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

interface FetchInit {
  readonly headers?: Record<string, string>;
}
type FetchFn = (url: string, init?: FetchInit) => Promise<{ json(): Promise<unknown> }>;

const DEFAULT_BASE_URL = 'https://api.alldebrid.com';

// Unlocks a filehoster link via AllDebrid v4. The api key travels in the
// `Authorization: Bearer` header (the method AllDebrid documents), NOT in the
// query string — so it never lands in AllDebrid's or an intermediary proxy's
// access logs. A network failure is still re-thrown sanitized so the key can't
// leak into the worker's job-error log either.
export class AllDebridAdapter implements DebridPort {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async unlock(link: FilehosterLink): Promise<DebridResult> {
    const url = new URL(`${this.baseUrl}/v4/link/unlock`);
    url.searchParams.set('agent', 'kobox');
    url.searchParams.set('link', link.value);

    let body: unknown;
    try {
      const response = await this.fetchFn(url.toString(), {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
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
