import {
  aria2ErrorSchema,
  aria2GidResultSchema,
  aria2StatusResultSchema,
} from '../../application/ddl/aria2Schemas.js';
import type { DirectUrl } from '../../domain/ddl/DirectUrl.js';
import { DownloadGid } from '../../domain/ddl/DownloadGid.js';
import type { DownloaderPort, DownloadState } from '../../domain/ddl/ports.js';
import { DownloadProgress } from '../../domain/ddl/DownloadProgress.js';

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

  async checkReachable(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.call('aria2.getVersion', [this.token()]);
      return { ok: true, detail: 'aria2 answered an authenticated call' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  // forceRemove, not remove: a download that is paused or already errored must
  // still leave the queue, and remove() refuses those states.
  async cancel(gid: DownloadGid): Promise<{ stagedPath?: string }> {
    const stagedPath = await this.stagedPathOf(gid);
    await this.call('aria2.forceRemove', [this.token(), gid.value]).catch(() => undefined);
    // removeDownloadResult forgets the finished/removed entry so a later poll
    // does not resurrect a row the member asked to be rid of
    await this.call('aria2.removeDownloadResult', [this.token(), gid.value]).catch(
      () => undefined,
    );
    return stagedPath === undefined ? {} : { stagedPath };
  }

  private async stagedPathOf(gid: DownloadGid): Promise<string | undefined> {
    try {
      const body = await this.call('aria2.tellStatus', [this.token(), gid.value, ['files']]);
      return aria2StatusResultSchema.parse(body).result.files?.[0]?.path;
    } catch {
      return undefined; // aria2 has already forgotten it: nothing to clean
    }
  }

  async status(gid: DownloadGid): Promise<DownloadState> {
    const body = await this.call('aria2.tellStatus', [
      this.token(),
      gid.value,
      ['status', 'files', 'errorMessage', 'completedLength', 'totalLength'],
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
    const progress = DownloadProgress.of(
      Number(result.completedLength ?? '0'),
      Number(result.totalLength ?? '0'),
    );
    return { state: 'active', ...(progress !== undefined && { progress }) };
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
