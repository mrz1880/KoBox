import { alldebridDelayedSchema, alldebridUnlockSchema } from '../../application/ddl/debridSchemas.js';
import type { DebridApiKey } from '../../domain/ddl/DebridApiKey.js';
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
type SleepFn = (ms: number) => Promise<void>;

const DEFAULT_BASE_URL = 'https://api.alldebrid.com';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_DELAYED_ATTEMPTS = 24; // ~2 min before the link is failed

const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Test/tuning seam for the delayed-link poll loop (default: real 5s spacing).
export interface DelayedTuning {
  readonly sleep?: SleepFn;
  readonly pollIntervalMs?: number;
  readonly maxAttempts?: number;
}

// Unlocks a filehoster link via AllDebrid v4 with the KEY OF THE REQUESTING USER
// (accounts are per-user), so the adapter is stateless. The api key travels in the
// `Authorization: Bearer` header (the documented method), NOT the query string —
// so it never lands in AllDebrid's or an intermediary proxy's access logs; a
// network failure is re-thrown sanitized so it can't leak into the worker log
// either. Some hosts (1fichier free, …) don't return the link immediately but a
// `delayed` id; that whole flow is resolved HERE so `DebridPort.unlock` stays a
// plain "link in, direct url out" — the domain never learns AllDebrid delays.
// The poll blocks the worker job for up to the budget, then fails the row.
export class AllDebridAdapter implements DebridPort {
  private readonly sleep: SleepFn;
  private readonly pollIntervalMs: number;
  private readonly maxDelayedAttempts: number;

  constructor(
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchFn: FetchFn = fetch,
    tuning: DelayedTuning = {},
  ) {
    this.sleep = tuning.sleep ?? realSleep;
    this.pollIntervalMs = tuning.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxDelayedAttempts = tuning.maxAttempts ?? DEFAULT_MAX_DELAYED_ATTEMPTS;
  }

  async unlock(link: FilehosterLink, apiKey: DebridApiKey): Promise<DebridResult> {
    const url = new URL(`${this.baseUrl}/v4/link/unlock`);
    url.searchParams.set('agent', 'kobox');
    url.searchParams.set('link', link.value);

    const parsed = alldebridUnlockSchema.parse(await this.getJson(url, apiKey));
    if (parsed.status === 'error') {
      throw new DebridError(parsed.error.code, parsed.error.message);
    }
    if (parsed.data.link !== undefined) {
      return this.result(parsed.data.link, parsed.data.filename);
    }
    if (parsed.data.delayed !== undefined) {
      return this.result(
        await this.awaitDelayed(parsed.data.delayed, apiKey),
        parsed.data.filename,
      );
    }
    throw new DebridError('unexpected', 'debrid returned neither a link nor a delayed id');
  }

  // Polls /v4/link/delayed until the link is generated (status 2), the host
  // gives up (status 3), or the budget runs out — whichever comes first.
  private async awaitDelayed(id: number, apiKey: DebridApiKey): Promise<string> {
    const url = new URL(`${this.baseUrl}/v4/link/delayed`);
    url.searchParams.set('id', String(id));
    for (let attempt = 0; attempt < this.maxDelayedAttempts; attempt += 1) {
      await this.sleep(this.pollIntervalMs);
      const parsed = alldebridDelayedSchema.parse(await this.getJson(url, apiKey));
      if (parsed.status === 'error') {
        throw new DebridError(parsed.error.code, parsed.error.message);
      }
      if (parsed.data.status === 2 && parsed.data.link !== undefined) {
        return parsed.data.link;
      }
      if (parsed.data.status === 3) {
        throw new DebridError('delayed', 'debrid could not generate the download link');
      }
      // status 1 (or 2 without a link yet): keep waiting
    }
    throw new DebridError('delayed-timeout', 'debrid link still processing after the poll budget');
  }

  private result(link: string, filename?: string): DebridResult {
    return {
      direct: DirectUrl.parse(link),
      ...(filename !== undefined && { filename }),
    };
  }

  private async getJson(url: URL, apiKey: DebridApiKey): Promise<unknown> {
    try {
      const response = await this.fetchFn(url.toString(), {
        headers: { authorization: `Bearer ${apiKey.reveal()}` },
      });
      return await response.json();
    } catch {
      throw new DebridError('network', 'debrid request failed');
    }
  }
}
