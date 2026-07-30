import {
  aria2ErrorSchema,
  aria2GidResultSchema,
  aria2StatusResultSchema,
} from '../../application/ddl/aria2Schemas.js';
import type { DirectUrl } from '../../domain/ddl/DirectUrl.js';
import { DownloadGid } from '../../domain/ddl/DownloadGid.js';
import type { DownloaderPort, DownloadState } from '../../domain/ddl/ports.js';

export class Aria2Error extends Error {
  constructor(message: string) {
    super(`aria2 error: ${message}`);
    this.name = 'Aria2Error';
  }
}

type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ json(): Promise<unknown> }>;

const RPC_ID = 'kobox';

// Drives aria2 over JSON-RPC. The secret token rides in every request body, so
// a network failure is re-thrown sanitized — the token never reaches a log.
export class Aria2Adapter implements DownloaderPort {
  constructor(
    private readonly rpcUrl: string,
    private readonly secret: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async addUri(url: DirectUrl, dir: string): Promise<DownloadGid> {
    const body = await this.call('aria2.addUri', [this.token(), [url.value], { dir }]);
    return DownloadGid.parse(aria2GidResultSchema.parse(body).result);
  }

  async status(gid: DownloadGid): Promise<DownloadState> {
    const body = await this.call('aria2.tellStatus', [
      this.token(),
      gid.value,
      ['status', 'files', 'errorMessage'],
    ]);
    const { result } = aria2StatusResultSchema.parse(body);
    if (result.status === 'complete') {
      const filePath = result.files?.[0]?.path;
      return { state: 'complete', ...(filePath !== undefined && { filePath }) };
    }
    if (result.status === 'error' || result.status === 'removed') {
      return {
        state: 'error',
        ...(result.errorMessage !== undefined && { message: result.errorMessage }),
      };
    }
    return { state: 'active' };
  }

  private token(): string {
    return `token:${this.secret}`;
  }

  private async call(method: string, params: readonly unknown[]): Promise<unknown> {
    let body: unknown;
    try {
      const response = await this.fetchFn(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: RPC_ID, method, params }),
      });
      body = await response.json();
    } catch {
      throw new Aria2Error('request failed');
    }
    const asError = aria2ErrorSchema.safeParse(body);
    if (asError.success) {
      throw new Aria2Error(asError.data.error.message);
    }
    return body;
  }
}
