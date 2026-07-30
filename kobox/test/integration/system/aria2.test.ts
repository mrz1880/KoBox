import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DirectUrl } from '../../../src/domain/ddl/DirectUrl.js';
import { DownloadGid } from '../../../src/domain/ddl/DownloadGid.js';
import { Aria2Adapter } from '../../../src/infrastructure/system/Aria2Adapter.js';

let server: Server;
let rpcUrl: string;
let lastRequest: { method?: string; params?: unknown } = {};
let reply: unknown = {};

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += String(chunk)));
      req.on('end', () => {
        lastRequest = JSON.parse(raw) as { method?: string; params?: unknown };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      rpcUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${String(addr.port)}/jsonrpc` : '';
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('Aria2Adapter', () => {
  it('should_add_a_uri_with_the_secret_token_and_return_the_gid', async () => {
    reply = { jsonrpc: '2.0', id: 'kobox', result: '2089b05ecca3d829' };
    const adapter = new Aria2Adapter(rpcUrl, 'RPCSECRET');

    const gid = await adapter.addUri(DirectUrl.parse('https://cdn.example/f.mkv'), '/staging');

    expect(gid.value).toBe('2089b05ecca3d829');
    expect(lastRequest.method).toBe('aria2.addUri');
    const params = lastRequest.params as unknown[];
    expect(params[0]).toBe('token:RPCSECRET');
    expect(params[1]).toEqual(['https://cdn.example/f.mkv']);
    expect(params[2]).toEqual({ dir: '/staging' });
  });

  it('should_map_a_complete_status_with_its_file_path', async () => {
    reply = {
      jsonrpc: '2.0',
      id: 'kobox',
      result: { status: 'complete', files: [{ path: '/staging/Movie.mkv' }] },
    };
    const adapter = new Aria2Adapter(rpcUrl, 'RPCSECRET');

    const state = await adapter.status(DownloadGid.parse('2089b05ecca3d829'));

    expect(state.state).toBe('complete');
    expect(state.filePath).toBe('/staging/Movie.mkv');
  });

  it('should_map_an_error_status_with_its_message', async () => {
    reply = {
      jsonrpc: '2.0',
      id: 'kobox',
      result: { status: 'error', errorMessage: 'connection timed out' },
    };
    const adapter = new Aria2Adapter(rpcUrl, 'RPCSECRET');

    const state = await adapter.status(DownloadGid.parse('2089b05ecca3d829'));

    expect(state.state).toBe('error');
    expect(state.message).toBe('connection timed out');
  });

  it('should_map_a_running_status_to_active', async () => {
    reply = { jsonrpc: '2.0', id: 'kobox', result: { status: 'active' } };
    const adapter = new Aria2Adapter(rpcUrl, 'RPCSECRET');

    expect((await adapter.status(DownloadGid.parse('2089b05ecca3d829'))).state).toBe('active');
  });

  it('should_not_leak_the_rpc_secret_on_a_network_failure', async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    const adapter = new Aria2Adapter(rpcUrl, 'TOPSECRET');

    let message = '';
    try {
      await adapter.addUri(DirectUrl.parse('https://cdn.example/f.mkv'), '/staging');
      throw new Error('expected a rejection');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain('TOPSECRET');
    expect(message).not.toBe('expected a rejection');
  });
});
