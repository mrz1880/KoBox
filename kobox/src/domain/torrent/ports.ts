import type { ManagedFilesPort } from '../shared/files.js';
import type { ScgiPort } from '../user/Port.js';
import type { Username } from '../user/Username.js';
import type { Announcer } from './Announcer.js';
import type { InfoHash } from './InfoHash.js';
import type { RecyclingMode } from './RecyclingMode.js';
import type { Torrent } from './Torrent.js';
import type { TorrentInstance } from './TorrentInstance.js';
import type { WatchDir } from './WatchDir.js';
import type { RenderedFile } from '../shared/files.js';

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
  // Removes the folder's watch, complete and torrents directories only when
  // all three hold nothing; false when one does, and then nothing is touched.
  removeIfEmpty(username: Username, dir: WatchDir): Promise<boolean>;
}

// Moves a .torrent the member dropped into a watch folder to where it is kept
// once added (torrents/ of the same category).
export interface TorrentFilingPort {
  file(torrentFile: string, folder: string): Promise<void>;
}

// The per-member PHP pools ruTorrent runs in: exactly these and no others,
// checked by PHP before it reloads, so one bad pool never stops the rest.
export interface RutorrentPoolsPort {
  converge(pools: readonly RenderedFile[]): Promise<void>;
}

// What keeps its own index of a member's folders (Nextcloud) and does not see
// the ones made behind its back until told to look again.
export interface FileIndexPort {
  refresh(username: Username): Promise<void>;
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
  start(scgiPort: ScgiPort, infoHash: InfoHash): Promise<void>;
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

// Torrent -> Tracker context seam: announcers seen at insert time
// are published outward; the Tracker context consumes them as discovery jobs.
// The Torrent context knows nothing about trackers beyond this port.
export interface AnnouncerSink {
  publish(announcers: readonly Announcer[], privacy: 'public' | 'private'): Promise<void>;
}

// A member's ruTorrent profile folder (settings, the answers to its external
// checks): readable and writable by the member's own rTorrent and by the web
// server, by nobody else. Idempotent, and it repairs a folder left too open.
export interface RutorrentProfilePort {
  ensureProfile(username: Username): Promise<void>;
  // the folder holding the member's config, open to their ruTorrent alone
  ensureConfigFolder(username: Username): Promise<void>;
  // KoBox's ratio groups, in place of ruTorrent's eight alike ones, for a
  // member who never changed theirs; one who did keeps their own
  offerRatioGroups(username: Username): Promise<void>;
}

