export interface RtorrentInstanceProvisioned {
  readonly type: 'RtorrentInstanceProvisioned';
  readonly username: string;
}

export interface WatchDirAdded {
  readonly type: 'WatchDirAdded';
  readonly username: string;
  readonly label: string;
}

export type TorrentEvent = RtorrentInstanceProvisioned | WatchDirAdded;
