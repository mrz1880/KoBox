import type { Username } from '../user/Username.js';
import type { DebridApiKey } from './DebridApiKey.js';
import type { DebridDownload } from './DebridDownload.js';
import type { DownloadCategory } from './DownloadCategory.js';
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

// Moves a finished download from the aria2 staging dir into the user's
// ~/rtorrent/complete/<category>/ (the layout Radarr/Sonarr import from) and
// hands ownership to the user. Root-only (the worker). Returns the final path.
export interface DownloadPlacementPort {
  place(stagedPath: string, username: Username, category: DownloadCategory): Promise<string>;
}

// Resolves a filehoster link to an unrestricted direct URL, using the key of the
// user who asked — accounts are per-user, so the key is a per-call parameter.
export interface DebridPort {
  unlock(link: FilehosterLink, apiKey: DebridApiKey): Promise<DebridResult>;
}

// The user's own AllDebrid key, ready to use: the adapter reads the stored
// ciphertext and decrypts it. undefined = this user has no account configured,
// which is never fatal — only their downloads are unavailable.
export interface DebridCredentialsPort {
  forUser(username: Username): Promise<DebridApiKey | undefined>;
}

// Sealing (portal side) and opening (worker side) are SEPARATE interfaces so the
// type system shows the non-root portal can never reach the private half.
export interface DebridKeyEncryptorPort {
  encrypt(key: DebridApiKey): Promise<string>;
}

export interface DebridKeyDecryptorPort {
  decrypt(sealed: string): Promise<DebridApiKey>;
}

// Provisions the RSA pair that seals per-user debrid keys, at install time.
// MUST be idempotent: regenerating an existing private half would silently
// orphan every stored key. A missing public half is re-derived, never a pretext
// to make a new pair.
export interface DebridKeyPairPort {
  ensurePair(): Promise<void>;
}

export interface DebridAccountRepository {
  // upsert: one key per user, replacing any previous one
  save(username: Username, encryptedKey: string, now: string): Promise<void>;
  findEncrypted(username: Username): Promise<string | undefined>;
  remove(username: Username): Promise<void>;
  has(username: Username): Promise<boolean>;
}

export interface DebridDownloadRepository {
  // insert when the download has no id (returns it identified), update otherwise
  save(download: DebridDownload): Promise<DebridDownload>;
  findById(id: number): Promise<DebridDownload | undefined>;
  // the poll loop's work list: everything still downloading
  listActive(): Promise<readonly DebridDownload[]>;
  listForUser(username: Username): Promise<readonly DebridDownload[]>;
}
