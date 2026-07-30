import type { Username } from '../user/Username.js';
import type { DebridDownload } from './DebridDownload.js';
import type { DirectUrl } from './DirectUrl.js';
import type { DownloadGid } from './DownloadGid.js';
import type { FilehosterLink } from './FilehosterLink.js';

export interface DebridResult {
  readonly direct: DirectUrl;
  readonly filename?: string;
}

export type DownloadRunState = 'active' | 'complete' | 'error';

export interface DownloadState {
  readonly state: DownloadRunState;
  readonly filePath?: string;
  readonly message?: string;
}

// The download engine (aria2). Fetches a direct URL into a staging dir and
// reports progress by gid. The RPC secret it needs lives in the adapter only.
export interface DownloaderPort {
  addUri(url: DirectUrl, dir: string): Promise<DownloadGid>;
  status(gid: DownloadGid): Promise<DownloadState>;
}

// Resolves a filehoster link to an unrestricted direct URL. The API key it
// needs lives in the adapter (worker env) — never in the domain or the DB.
export interface DebridPort {
  unlock(link: FilehosterLink): Promise<DebridResult>;
}

export interface DebridDownloadRepository {
  // insert when the download has no id (returns it identified), update otherwise
  save(download: DebridDownload): Promise<DebridDownload>;
  findById(id: number): Promise<DebridDownload | undefined>;
  // the poll loop's work list: everything still downloading
  listActive(): Promise<readonly DebridDownload[]>;
  listForUser(username: Username): Promise<readonly DebridDownload[]>;
}
