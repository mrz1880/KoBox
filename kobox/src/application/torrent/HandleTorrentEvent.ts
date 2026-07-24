import type { EventHookType } from '../../domain/torrent/EventHook.js';
import type { InfoHash } from '../../domain/torrent/InfoHash.js';
import type { Label } from '../../domain/torrent/Label.js';
import { Torrent } from '../../domain/torrent/Torrent.js';
import { TorrentState } from '../../domain/torrent/TorrentState.js';
import type { TorrentInstance } from '../../domain/torrent/TorrentInstance.js';
import type {
  AnnouncerSink,
  RtorrentControlPort,
  TorrentInstanceRepository,
  TorrentMetainfoPort,
  TorrentRepository,
  UserScriptRunnerPort,
} from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { TorrentInstanceNotFoundError } from './errors.js';

export interface TorrentEventCommand {
  readonly username: Username;
  readonly event: EventHookType;
  readonly infoHash: InfoHash;
  readonly name?: string;
  readonly directory?: string;
  readonly basePath?: string;
  readonly torrentFile?: string;
  readonly label?: Label;
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
  readonly torrents: TorrentRepository;
  readonly metainfo: TorrentMetainfoPort;
  readonly control: RtorrentControlPort;
  readonly scripts: UserScriptRunnerPort;
  readonly announcers: AnnouncerSink;
}

// The typed replacement for the legacy 400-line bash hooks. Behavior flags
// are read from the instance at event time (DB-backed, restart-proof) —
// exactly what the two erased prod file patches tried to hand-hack.
export class HandleTorrentEvent {
  constructor(private readonly deps: Deps) {}

  async execute(command: TorrentEventCommand): Promise<void> {
    const instance = await this.deps.instances.findByUsername(command.username);
    if (!instance) {
      throw new TorrentInstanceNotFoundError(command.username.value);
    }
    // Privilege-seam guard: a shell user could point the shim at any absolute
    // path. The root worker must only ever touch paths under the user's own
    // home — anything else is ignored (never read, never stored).
    const home = `/home/${command.username.value}/`;
    const provided = [command.torrentFile, command.directory, command.basePath];
    if (provided.some((path) => path !== undefined && !path.startsWith(home))) {
      return;
    }
    switch (command.event) {
      case 'inserted_new':
        await this.onInsertedNew(instance, command);
        return;
      case 'finished':
        await this.onFinished(instance, command);
        return;
      case 'erased':
        await this.deps.torrents.delete(command.username, command.infoHash);
        return;
    }
  }

  private async onInsertedNew(instance: TorrentInstance, command: TorrentEventCommand): Promise<void> {
    // Native early-exit (ex-Radarr bypass patch): an XMLRPC add carries no
    // .torrent file — nothing to inspect, nothing to do, and above all no crash.
    if (command.torrentFile === undefined) {
      return;
    }
    const metainfo = await this.deps.metainfo.read(command.torrentFile);
    if (!metainfo) {
      return;
    }
    // Tracker discovery happens on every readable insert, accepted or not:
    // rejection is the user's policy, tracker knowledge is global. Best-effort
    // — a sink failure must never fail the event.
    if (metainfo.announcers.length > 0) {
      await this.deps.announcers
        .publish(metainfo.announcers, metainfo.isPrivate ? 'private' : 'public')
        .catch(() => undefined);
    }
    const torrent = Torrent.load({
      infoHash: command.infoHash,
      name: command.name ?? metainfo.name,
      ...(command.label !== undefined && { label: command.label }),
    });
    const decision = instance.admitTorrent(metainfo.isPrivate ? 'private' : 'public');
    if (decision === 'accepted') {
      await this.deps.torrents.upsert(command.username, torrent);
      return;
    }
    await this.deps.torrents.upsert(command.username, torrent.reject());
    // Best-effort: the rejection is recorded even if rtorrent is unreachable.
    await this.deps.control
      .stopAndClose(instance.scgiPort, command.infoHash)
      .catch(() => undefined);
  }

  private async onFinished(instance: TorrentInstance, command: TorrentEventCommand): Promise<void> {
    const existing = await this.deps.torrents.findByInfoHash(command.username, command.infoHash);
    if (existing?.state === TorrentState.rejected) {
      return; // a rejected torrent was stopped+closed: ignore a stray finish
    }
    const name = command.name ?? existing?.name ?? command.infoHash.value;
    const base =
      existing ??
      Torrent.load({
        infoHash: command.infoHash,
        name,
        ...(command.label !== undefined && { label: command.label }),
      });
    const tree = command.basePath ?? command.directory ?? existing?.tree ?? '';
    await this.deps.torrents.upsert(command.username, base.complete(tree));

    if (instance.syncDisabled) {
      return; // per-user flag (converted prod patch): no post-download fan-out
    }
    await this.deps.scripts.runFinishedScripts(command.username, {
      basePath: command.basePath ?? '',
      directory: command.directory ?? '',
      label: command.label?.value ?? '',
      name,
    });
  }
}
