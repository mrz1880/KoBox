import {
  CleanupReport,
  type CleanupTrigger,
  type DeletedLine,
  type SkippedLine,
} from '../../domain/space/CleanupReport.js';
import type {
  CleanupReportRepository,
  MemberTorrentsPort,
  TorrentDataPort,
} from '../../domain/space/ports.js';
import type {
  DiskUsageRepository,
  QuotaGaugePort,
  QuotaPort,
  UserRepository,
} from '../../domain/user/ports.js';
import type { InfoHash } from '../../domain/torrent/InfoHash.js';
import type { TorrentInstanceRepository } from '../../domain/torrent/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { CleanupJudge, type CleanupJudgeDeps } from './CleanupJudge.js';
import { SpaceMailer, type SpaceMailerDeps } from './SpaceMailer.js';
import type { TakeCleanupSnapshot } from './TakeCleanupSnapshot.js';

export interface CleanUpSpaceCommand {
  readonly username: Username;
  readonly infoHashes: readonly InfoHash[];
  readonly trigger: CleanupTrigger;
}

interface Deps extends CleanupJudgeDeps {
  readonly instances: TorrentInstanceRepository;
  readonly torrents: MemberTorrentsPort;
  readonly data: TorrentDataPort;
  readonly reports: CleanupReportRepository;
  readonly quota: Pick<QuotaPort, 'getUsage'>;
  readonly samples: DiskUsageRepository;
  // ruTorrent's meter, shown the new usage against the member's allowance
  readonly users: Pick<UserRepository, 'findByUsername'>;
  readonly gauges: QuotaGaugePort;
  readonly snapshot: Pick<TakeCleanupSnapshot, 'execute'>;
  readonly mail: SpaceMailerDeps;
  readonly clock: () => string;
}

// Deletes the torrents a member picked, each one judged again live first: the
// snapshot they picked from may be an hour old. A torrent goes from rTorrent
// first, then its files, so no file is removed under a torrent still seeding.
// One torrent that cannot go is reported and the others still go. The report
// is saved before the usage is measured again, so a failing measure cannot
// lose what was deleted. The new usage is shown on the home and on ruTorrent's
// meter at once, rather than at the next hourly pass.
export class CleanUpSpace {
  private readonly mailer: SpaceMailer;

  constructor(private readonly deps: Deps) {
    this.mailer = new SpaceMailer(deps.mail);
  }

  // Answers the report it saved, so the worker can log what failed.
  async execute(command: CleanUpSpaceCommand): Promise<CleanupReport> {
    const at = this.deps.clock();
    const instance = await this.deps.instances.findByUsername(command.username);
    // without an rTorrent, nothing picked is still there to delete
    const finished =
      instance === undefined ? [] : await this.deps.torrents.listFinished(instance.scgiPort);
    const judge = await CleanupJudge.of(this.deps, command.username, at);
    const deleted: DeletedLine[] = [];
    const skipped: SkippedLine[] = [];
    for (const infoHash of command.infoHashes) {
      const torrent = finished.find((one) => one.infoHash.equals(infoHash));
      if (instance === undefined || torrent === undefined) {
        // no name to show for what rTorrent no longer lists: the hash stands in
        skipped.push({ name: infoHash.value, reason: 'gone' });
        continue;
      }
      const candidate = judge.judge(torrent);
      if (candidate === undefined) {
        skipped.push({ name: torrent.name, reason: 'noLongerQualifies' });
        continue;
      }
      try {
        await this.deps.torrents.erase(instance.scgiPort, infoHash);
      } catch {
        // rTorrent still holds it: its files stay where they are
        skipped.push({ name: candidate.name, reason: 'notErased' });
        continue;
      }
      try {
        await this.deps.data.remove(command.username, candidate.path);
      } catch {
        // gone from rTorrent, still on disk (or refused as outside the
        // member's space): the member sees it in Files and is told here
        skipped.push({ name: candidate.name, reason: 'dataKept' });
        continue;
      }
      deleted.push({ name: candidate.name, size: candidate.size });
    }
    const report = CleanupReport.of({ deleted, skipped, at, trigger: command.trigger });
    await this.deps.reports.save(command.username, report);
    // the member did not click anything: they are told what went
    if (command.trigger === 'automatic') {
      await this.mailer.automaticCleanup(command.username, report);
    }
    const used = await this.deps.quota.getUsage(command.username);
    await this.deps.samples.save({ username: command.username, used, sampledAt: at });
    // a member removed meanwhile has no meter left to show it on
    const user = await this.deps.users.findByUsername(command.username);
    if (user !== undefined) {
      await this.deps.gauges.show(command.username, used, user.quota);
    }
    await this.deps.snapshot.execute(command.username, at);
    return report;
  }
}
