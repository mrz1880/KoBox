import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilehosterLink } from '../../../src/domain/ddl/FilehosterLink.js';
import {
  AllDebridAdapter,
  DebridError,
  type DelayedTuning,
} from '../../../src/infrastructure/system/AllDebridAdapter.js';

let server: Server;
let baseUrl: string;
let lastQuery: URLSearchParams | undefined;
let lastAuth: string | undefined;
let delayedIds: string[] = [];
// per-path response bodies; /link/delayed pulls the next queued body each call
let unlockBody: unknown = {};
let delayedQueue: unknown[] = [];

beforeEach(async () => {
  lastQuery = undefined;
  lastAuth = undefined;
  delayedIds = [];
  unlockBody = {};
  delayedQueue = [];
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://x');
      lastQuery = url.searchParams;
      lastAuth = req.headers.authorization;
      res.writeHead(200, { 'content-type': 'application/json' });
      if (url.pathname === '/v4/link/delayed') {
        delayedIds.push(url.searchParams.get('id') ?? '');
        res.end(JSON.stringify(delayedQueue.shift() ?? { status: 'success', data: { status: 1 } }));
        return;
      }
      res.end(JSON.stringify(unlockBody));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${String(addr.port)}` : '';
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
});

const link = FilehosterLink.parse('https://1fichier.example/abc');
// never actually wait in tests: no-op sleep, a tight poll budget
const fast: DelayedTuning = { sleep: () => Promise.resolve(), pollIntervalMs: 0, maxAttempts: 4 };

describe('AllDebridAdapter', () => {
  it('should_unlock_a_link_into_a_direct_url_and_filename', async () => {
    unlockBody = {
      status: 'success',
      data: { link: 'https://cdn.example/Movie.2026.mkv', filename: 'Movie.2026.mkv', filesize: 42 },
    };
    const adapter = new AllDebridAdapter('SECRETKEY', baseUrl);

    const result = await adapter.unlock(link);

    expect(result.direct.value).toBe('https://cdn.example/Movie.2026.mkv');
    expect(result.filename).toBe('Movie.2026.mkv');
    // the key rides in the Authorization header, never the URL (it would land
    // in AllDebrid's/proxy access logs otherwise); link + agent stay in the query
    expect(lastAuth).toBe('Bearer SECRETKEY');
    expect(lastQuery?.get('apikey')).toBeNull();
    expect(lastQuery?.get('link')).toBe('https://1fichier.example/abc');
    expect(lastQuery?.get('agent')).toBe('kobox');
  });

  it('should_poll_a_delayed_link_until_it_is_ready', async () => {
    unlockBody = { status: 'success', data: { delayed: 777, filename: 'Delayed.mkv' } };
    delayedQueue = [
      { status: 'success', data: { status: 1 } }, // still processing
      { status: 'success', data: { status: 1 } },
      { status: 'success', data: { status: 2, link: 'https://cdn.example/Delayed.mkv' } },
    ];
    const adapter = new AllDebridAdapter('SECRETKEY', baseUrl, fetch, fast);

    const result = await adapter.unlock(link);

    expect(result.direct.value).toBe('https://cdn.example/Delayed.mkv');
    expect(result.filename).toBe('Delayed.mkv');
    // it polled /link/delayed with the id from the unlock response, Bearer-authed
    expect(delayedIds).toEqual(['777', '777', '777']);
    expect(lastAuth).toBe('Bearer SECRETKEY');
  });

  it('should_fail_when_the_delayed_host_gives_up', async () => {
    unlockBody = { status: 'success', data: { delayed: 42 } };
    delayedQueue = [{ status: 'success', data: { status: 3 } }];
    const adapter = new AllDebridAdapter('SECRETKEY', baseUrl, fetch, fast);

    await expect(adapter.unlock(link)).rejects.toThrow(DebridError);
  });

  it('should_fail_when_the_delayed_link_never_becomes_ready', async () => {
    unlockBody = { status: 'success', data: { delayed: 42 } };
    // queue empty -> the stub keeps returning status 1; the budget runs out
    const adapter = new AllDebridAdapter('SECRETKEY', baseUrl, fetch, fast);

    await expect(adapter.unlock(link)).rejects.toThrow(/delayed-timeout/);
    expect(delayedIds).toHaveLength(4); // maxAttempts, then it gave up
  });

  it('should_raise_a_typed_error_on_a_debrid_error_response', async () => {
    unlockBody = {
      status: 'error',
      error: { code: 'LINK_HOST_NOT_SUPPORTED', message: 'host unsupported' },
    };
    const adapter = new AllDebridAdapter('SECRETKEY', baseUrl);

    await expect(adapter.unlock(link)).rejects.toThrow(DebridError);
  });

  it('should_not_leak_the_api_key_in_a_network_failure', async () => {
    await new Promise<void>((resolve) => server.close(() => { resolve(); })); // no server listening
    const adapter = new AllDebridAdapter('SUPERSECRET', baseUrl);

    let message = '';
    try {
      await adapter.unlock(link);
      throw new Error('expected a rejection');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain('SUPERSECRET');
    expect(message).not.toBe('expected a rejection');
  });
});
