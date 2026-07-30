import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilehosterLink } from '../../../src/domain/ddl/FilehosterLink.js';
import { AllDebridAdapter, DebridError } from '../../../src/infrastructure/system/AllDebridAdapter.js';

let server: Server;
let baseUrl: string;
let lastQuery: URLSearchParams | undefined;
let response: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      lastQuery = new URL(req.url ?? '', 'http://x').searchParams;
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response.body));
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

describe('AllDebridAdapter', () => {
  it('should_unlock_a_link_into_a_direct_url_and_filename', async () => {
    response = {
      status: 200,
      body: {
        status: 'success',
        data: { link: 'https://cdn.example/Movie.2026.mkv', filename: 'Movie.2026.mkv', filesize: 42 },
      },
    };
    const adapter = new AllDebridAdapter('SECRETKEY', baseUrl);

    const result = await adapter.unlock(link);

    expect(result.direct.value).toBe('https://cdn.example/Movie.2026.mkv');
    expect(result.filename).toBe('Movie.2026.mkv');
    // the key + link are passed as query params (agent identifies the app)
    expect(lastQuery?.get('apikey')).toBe('SECRETKEY');
    expect(lastQuery?.get('link')).toBe('https://1fichier.example/abc');
    expect(lastQuery?.get('agent')).toBe('kobox');
  });

  it('should_raise_a_typed_error_on_a_debrid_error_response', async () => {
    response = {
      status: 200,
      body: { status: 'error', error: { code: 'LINK_HOST_NOT_SUPPORTED', message: 'host unsupported' } },
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
