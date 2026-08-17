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
import type { UserRepository } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { MailOutboxPort } from '../maintenance/MailOutboxPort.js';
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
  // rTorrent's own answer (d.is_private), carried on the event. It is the only
  // source that exists for every way a torrent can arrive.
  readonly isPrivate?: boolean;
}

// Plain words, and the reason first: the member did nothing wrong procedurally,
// they hit a rule of this box.
function removalBody(name: string): string {
  return [
    `"${name}" has been taken out of your seedbox.`,
    '',
    'It announces to a public tracker, and this seedbox only carries private',
    'ones. Public trackers are watched by anti-piracy monitors, which puts the',
    'whole machine at risk, so the rule applies to everybody.',
    '',
    'Nothing else of yours was touched, and no files were deleted. If you think',
    'this torrent is private, tell an admin: they can check and, if they agree,',
    'allow public trackers on your account.',
  ].join('\n');
}

interface Deps {
  readonly instances: TorrentInstanceRepository;
  readonly torrents: TorrentRepository;
  readonly metainfo: TorrentMetainfoPort;
  readonly control: RtorrentControlPort;
  readonly scripts: UserScriptRunnerPort;
  readonly announcers: AnnouncerSink;
  readonly users: UserRepository;
  readonly outbox: MailOutboxPort;
  readonly clock: () => string;
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
    // An XMLRPC add (Sonarr, Radarr, any client driving rTorrent) carries no
    // .torrent file, so there is nothing on disk to inspect. Privacy still has
    // to be decided: skipping meant the rule silently did not apply, and
    // guessing meant a private torrent could be blocked as public, which is
    // exactly what made an operator disable the rule for themselves.
    //
    // rTorrent knows, and now says so on the event. The file is only needed for
    // tracker discovery and the fallback name.
    const metainfo =
      command.torrentFile === undefined
        ? undefined
        : await this.deps.metainfo.read(command.torrentFile);
    const isPrivate = command.isPrivate ?? metainfo?.isPrivate;
    if (isPrivate === undefined) {
      // no file and no answer: an older shim that has not been re-rendered.
      // Deciding either way would be a guess about somebody's tracker.
      return;
    }
    // Tracker discovery happens on every readable insert, accepted or not:
    // rejection is the user's policy, tracker knowledge is global. Best-effort:
    // a sink failure must never fail the event.
    if (metainfo !== undefined && metainfo.announcers.length > 0) {
      await this.deps.announcers
        .publish(metainfo.announcers, metainfo.isPrivate ? 'private' : 'public')
        .catch(() => undefined);
    }
    const torrent = Torrent.load({
      infoHash: command.infoHash,
      name: command.name ?? metainfo?.name ?? command.infoHash.value,
      ...(command.label !== undefined && { label: command.label }),
    });
    const decision = instance.admitTorrent(isPrivate ? 'private' : 'public');
    if (decision === 'accepted') {
      await this.deps.torrents.upsert(command.username, torrent);
      return;
    }
    await this.deps.torrents.upsert(command.username, torrent.reject());
    // Best-effort: the rejection is recorded even if rtorrent is unreachable.
    await this.deps.control
      .stopAndClose(instance.scgiPort, command.infoHash)
      .catch(() => undefined);
    await this.notifyRemoval(command.username, torrent.name);
  }

  // A torrent that vanishes without a word reads as a bug on KoBox's side. The
  // removal was already right; saying so is what was missing. Best-effort like
  // the stop above: a mail that cannot be queued must not fail the event, and
  // the rejection is already recorded either way.
  private async notifyRemoval(username: Username, name: string): Promise<void> {
    try {
      const user = await this.deps.users.findByUsername(username);
      if (user === undefined) {
        return;
      }
      await this.deps.outbox.enqueue(
        {
          recipient: user.email.value,
          subject: 'A torrent was removed from your seedbox',
          body: removalBody(name),
        },
        this.deps.clock(),
      );
    } catch {
      return;
    }
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
