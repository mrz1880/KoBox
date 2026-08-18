import { createHash } from 'node:crypto';
import { get, type RequestOptions } from 'node:https';
import { gunzipSync } from 'node:zlib';
import type { BlocklistDownloadPort, DownloadedList } from '../../domain/tracker/ports.js';
import type { Logger } from '../logging/logger.js';

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

// P2P format: "description:start-end"; bare "start-end" and CIDR lines are
// accepted too (personal lists). Comments and garbage are dropped here; the
// domain merge applies the numeric filters again (defense in depth).
function parseRanges(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const colon = line.lastIndexOf(':');
      return colon === -1 ? line : line.slice(colon + 1);
    })
    .filter((line) => /^[0-9][0-9./-]*$/.test(line));
}

// §5.6 closure, integrity half: the body must gunzip cleanly (when gzipped)
// and yield at least one range; the sha256 of the raw body is recorded so an
// operator can audit exactly what was applied.
export function decodeP2pDownload(body: Buffer): DownloadedList | undefined {
  let text: string;
  if (body.subarray(0, 2).equals(GZIP_MAGIC)) {
    try {
      text = gunzipSync(body).toString('utf8');
    } catch {
      return undefined; // truncated or corrupted archive
    }
  } else {
    text = body.toString('utf8');
  }
  const ranges = parseRanges(text);
  if (ranges.length === 0) {
    return undefined;
  }
  return { ranges, sha256: createHash('sha256').update(body).digest('hex') };
}

export interface HttpsDownloadOptions {
  readonly ca?: string; // test seam: fixture CA for the in-test https server
  readonly timeoutMs?: number; // default 30 s — a wedged mirror must not stall the worker
  // What the caller is willing to receive. A blocklist that will not stop
  // arriving must not fill the disk, so the default is deliberately small; an
  // application release is a different order of size and says so.
  readonly maxBytes?: number;
}

interface HttpsResponse {
  readonly status: number;
  readonly location?: string;
  readonly body?: Buffer;
}

// Every request path shares the same timeout: a server that accepts the
// connection and stalls (the classic dying-mirror failure) is cut off.
// Exported for the installation ArtifactFetchAdapter (same verified-download
// discipline, different consumer).
// node sends no User-Agent at all, and download.nextcloud.com answers 429 to a
// request without one. curl from the same box got 200, which made this look
// like a rate limit we had earned rather than a header we never sent. Saying
// who we are is also the polite thing to do to a mirror we did not pay for.
// no url in it: this repository is public and the pre-commit guard keeps the
// owner's account name out of the source, which is right. A bare product token
// is what the server wants anyway.
const USER_AGENT = 'KoBox/1.0';

export function httpsGet(
  url: string,
  options: HttpsDownloadOptions,
): Promise<HttpsResponse | undefined> {
  return new Promise((resolve) => {
    const requestOptions: RequestOptions = {
      headers: { 'user-agent': USER_AGENT },
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    };
    const request = get(url, requestOptions, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status !== 200) {
        response.resume();
        resolve({ status, ...(location !== undefined && { location }) });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (options.maxBytes ?? MAX_BODY_BYTES)) {
          request.destroy();
          resolve(undefined);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({ status, body: Buffer.concat(chunks) });
      });
      response.on('error', () => {
        resolve(undefined);
      });
    });
    request.on('error', () => {
      resolve(undefined);
    });
    request.setTimeout(options.timeoutMs ?? 30_000, () => {
      request.destroy();
      resolve(undefined);
    });
  });
}

export class HttpsBlocklistDownloadAdapter implements BlocklistDownloadPort {
  constructor(
    private readonly logger: Logger,
    private readonly options: HttpsDownloadOptions = {},
  ) {}

  // The url arrives from BlocklistUrl (+optional credentials): https by
  // construction. Any failure returns undefined — callers isolate per list.
  async fetch(url: string): Promise<DownloadedList | undefined> {
    let response = await httpsGet(url, this.options);
    // one https-only redirect hop (iblocklist mirrors do this)
    if (response?.location?.startsWith('https://')) {
      response = await httpsGet(response.location, this.options);
    }
    if (response?.body === undefined) {
      this.logger.warn('blocklist download failed');
      return undefined;
    }
    const decoded = decodeP2pDownload(response.body);
    if (!decoded) {
      this.logger.warn('blocklist body failed integrity checks');
    }
    return decoded;
  }
}
