import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
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

// A vendored application release is not a blocklist. The shared helper caps a
// body at 32 MB so a wedged mirror cannot fill the disk, which is right for a
// list of ranges and wrong for Nextcloud: its release is 281 MB, so the download
// was aborted and reported as a plain failure. ruTorrent, NanoMon and librespeed
// all happened to fit under the smaller cap, which is why nothing showed it.
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export function defaultBodyFetcher(options: HttpsDownloadOptions = {}): HttpsBodyFetcher {
  const withCap: HttpsDownloadOptions = { maxBytes: MAX_ARTIFACT_BYTES, ...options };
  return async (url) => {
    let response = await httpsGet(url, withCap);
    // one https-only redirect hop, like the blocklist downloads
    if (response?.location?.startsWith('https://')) {
      response = await httpsGet(response.location, withCap);
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
    // Write beside the target and rename into place. Overwriting directly fails
    // with ETXTBSY when the target is a binary the kernel is currently
    // executing — which is every upgrade of a vendored daemon while its unit is
    // up. rename() replaces the NAME: the running process keeps the old inode
    // until it exits, the next start gets the new one. It is also atomic, so a
    // crash mid-write cannot leave a half-written artifact behind the checksum
    // marker that says it is good.
    const staged = `${destPath}.incoming`;
    await writeFile(staged, body);
    await rename(staged, destPath);
  }
}
