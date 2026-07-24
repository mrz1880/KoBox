import type { ScgiPort } from '../user/Port.js';
import type { Username } from '../user/Username.js';
import type { Announcer } from './Announcer.js';
import type { InfoHash } from './InfoHash.js';
import type { Torrent } from './Torrent.js';
import type { TorrentInstance } from './TorrentInstance.js';
import type { WatchDir } from './WatchDir.js';

export interface TorrentInstanceRepository {
  findByUsername(username: Username): Promise<TorrentInstance | undefined>;
  save(instance: TorrentInstance): Promise<void>;
  delete(username: Username): Promise<void>;
}

export interface TorrentRepository {
  findByInfoHash(username: Username, infoHash: InfoHash): Promise<Torrent | undefined>;
  upsert(username: Username, torrent: Torrent): Promise<void>;
  delete(username: Username, infoHash: InfoHash): Promise<void>;
  listFor(username: Username): Promise<readonly Torrent[]>;
  deleteAllFor(username: Username): Promise<void>;
}

// A fully rendered managed file: content is the whole desired state. Applying
// it is idempotent — adapters write only when the on-disk content differs and
// never touch paths outside this list (no more destructive regeneration).
export interface RenderedFile {
  readonly path: string;
  readonly content: string;
  readonly mode: string; // octal, e.g. '0640'
  readonly owner: string;
  readonly group: string;
}

export interface RtorrentConfigPort {
  // Returns the paths whose content actually changed.
  apply(files: readonly RenderedFile[]): Promise<readonly string[]>;
}

export interface WatchDirPort {
  ensureLayout(username: Username, watchDirs: readonly WatchDir[]): Promise<void>;
}

export interface TorrentMetainfo {
  readonly infoHash: InfoHash;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly announcers: readonly Announcer[];
}

// undefined = file absent or not a readable torrent (the native early-exit
// for XMLRPC adds without a .torrent file).
export interface TorrentMetainfoPort {
  read(path: string): Promise<TorrentMetainfo | undefined>;
}

export interface RtorrentControlPort {
  stopAndClose(scgiPort: ScgiPort, infoHash: InfoHash): Promise<void>;
}

export interface FinishedScriptArgs {
  readonly basePath: string;
  readonly directory: string;
  readonly label: string;
  readonly name: string;
}

export interface UserScriptRunnerPort {
  runFinishedScripts(username: Username, args: FinishedScriptArgs): Promise<void>;
}
