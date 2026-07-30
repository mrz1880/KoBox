import type { Username } from '../user/Username.js';
import type { DebridDownload } from './DebridDownload.js';
import type { DirectUrl } from './DirectUrl.js';
import type { FilehosterLink } from './FilehosterLink.js';

export interface DebridResult {
  readonly direct: DirectUrl;
  readonly filename?: string;
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
