import type { Username } from '../user/Username.js';
import type { MediaFile, MediaPath } from './MediaFile.js';

export interface MediaEntry {
  readonly path: MediaPath;
  readonly sizeBytes: number;
}

// Walks a user's completed downloads. Root-side: the portal never touches disk.
export interface MediaScanPort {
  scan(username: Username): Promise<readonly MediaEntry[]>;
}

export interface MediaRepository {
  // the index mirrors the directory: files that vanished leave the list
  replaceFor(username: Username, entries: readonly MediaEntry[], now: string): Promise<void>;
  listFor(username: Username): Promise<readonly MediaFile[]>;
  find(username: Username, path: MediaPath): Promise<MediaFile | undefined>;
  removeFor(username: Username): Promise<void>;
}
