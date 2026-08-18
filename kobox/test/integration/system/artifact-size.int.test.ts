import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArtifactFetchAdapter,
  defaultBodyFetcher,
} from '../../../src/infrastructure/system/ArtifactFetchAdapter.js';

// Just over the 32 MB the shared helper allows a blocklist. Nextcloud's release
// is 281 MB, so it was aborted mid-body and surfaced as a plain "download
// failed" that said nothing about a size. ruTorrent, NanoMon and librespeed all
// fit under that cap, which is why nothing had ever shown it.
const OVERSIZED = Buffer.alloc(33 * 1024 * 1024, 0x41);
const DIGEST = createHash('sha256').update(OVERSIZED).digest('hex');

let dir = '';
let server: ReturnType<typeof createHttpsServer> | undefined;
let seenUserAgent: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-artifact-'));
});

afterEach(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function serve(body: Buffer): Promise<{ url: string; ca: string }> {
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ]);
  const ca = readFileSync(certPath, 'utf8');
  server = createHttpsServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    (request, response) => {
      seenUserAgent = request.headers['user-agent'];
      response.writeHead(200);
      response.end(body);
    },
  );
  const port = await new Promise<number>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
  return { url: `https://localhost:${String(port)}/nextcloud.tar.bz2`, ca };
}

describe('fetching a vendored application release', () => {
  it('should_accept_one_far_larger_than_a_blocklist_would_ever_be', async () => {
    const { url, ca } = await serve(OVERSIZED);
    const dest = join(dir, 'nextcloud.tar.bz2');
    const adapter = new ArtifactFetchAdapter(defaultBodyFetcher({ ca }));

    await adapter.fetchVerified(url, DIGEST, dest);

    expect(readFileSync(dest).length).toBe(OVERSIZED.length);
  }, 60_000);

  it('should_tell_the_server_who_is_asking', async () => {
    // node sends no User-Agent at all, and download.nextcloud.com answers 429
    // to that. curl from the same box got 200, which is what made this look
    // like a rate limit we had earned rather than a header we never sent.
    const { url, ca } = await serve(OVERSIZED);
    const adapter = new ArtifactFetchAdapter(defaultBodyFetcher({ ca }));

    await adapter.fetchVerified(url, DIGEST, join(dir, 'x.tar.bz2'));

    expect(seenUserAgent ?? '').toMatch(/KoBox/);
  }, 60_000);
});
