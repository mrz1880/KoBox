import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ArtifactFetchPort } from '../../domain/installation/ports.js';
import { httpsGet, type HttpsDownloadOptions } from './HttpsBlocklistDownloadAdapter.js';

export class ArtifactFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactFetchError';
  }
}

export type HttpsBodyFetcher = (url: string) => Promise<Buffer | undefined>;

export function defaultBodyFetcher(options: HttpsDownloadOptions = {}): HttpsBodyFetcher {
  return async (url) => {
    let response = await httpsGet(url, options);
    // one https-only redirect hop, like the blocklist downloads
    if (response?.location?.startsWith('https://')) {
      response = await httpsGet(response.location, options);
    }
    return response?.body;
  };
}

// §5.6 verified downloads for vendored apps (ruTorrent): the artifact only
// materializes at destPath once the digest matched — a mismatch or a failed
// download throws and leaves nothing behind.
export class ArtifactFetchAdapter implements ArtifactFetchPort {
  constructor(private readonly fetcher: HttpsBodyFetcher) {}

  async fetchVerified(url: string, sha256: string, destPath: string): Promise<void> {
    if (!url.startsWith('https://')) {
      throw new ArtifactFetchError(`refusing non-https artifact url ${url}`);
    }
    const body = await this.fetcher(url);
    if (body === undefined) {
      throw new ArtifactFetchError(`download failed: ${url}`);
    }
    const digest = createHash('sha256').update(body).digest('hex');
    if (digest !== sha256.toLowerCase()) {
      throw new ArtifactFetchError(
        `sha256 mismatch for ${url}: expected ${sha256}, got ${digest}`,
      );
    }
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, body);
  }
}
