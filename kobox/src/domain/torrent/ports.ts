import type { ManagedFilesPort } from '../shared/files.js';
import type { ScgiPort } from '../user/Port.js';
import type { Username } from '../user/Username.js';
import type { Announcer } from './Announcer.js';
import type { InfoHash } from './InfoHash.js';
import type { RecyclingMode } from './RecyclingMode.js';
import type { Torrent } from './Torrent.js';
import type { TorrentInstance } from './TorrentInstance.js';
import type { WatchDir } from './WatchDir.js';

export type { RenderedFile } from '../shared/files.js';

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
  // Someone else's finished copy of the same content, for recycling. Excluding
  // the asker matters: a member re-adding their own torrent must not be told to
  // copy it from themselves.
  findCompletedElsewhere(
    infoHash: InfoHash,
    excluding: Username,
  ): Promise<{ username: Username; tree: string } | undefined>;
}

// Puts an existing tree where a member's rtorrent expects to find it, so the
// torrent hash-checks and goes straight to seeding instead of downloading what
// this box already holds.
export interface ContentRecyclerPort {
  replicate(source: string, targetDir: string, mode: RecyclingMode): Promise<void>;
}

// RenderedFile moved to domain/shared/files.ts (re-exported above): the
// write-if-changed apply pattern now serves every context that renders config.
export type RtorrentConfigPort = ManagedFilesPort;

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

// Torrent -> Tracker context seam (AUDIT §2): announcers seen at insert time
// are published outward; the Tracker context consumes them as discovery jobs.
// The Torrent context knows nothing about trackers beyond this port.
export interface AnnouncerSink {
  publish(announcers: readonly Announcer[], privacy: 'public' | 'private'): Promise<void>;
}
