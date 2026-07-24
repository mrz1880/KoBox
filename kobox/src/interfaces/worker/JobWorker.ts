import { parseJob, type Job } from '../../application/jobs/contract.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import { EventHook } from '../../domain/torrent/EventHook.js';
import { InfoHash } from '../../domain/torrent/InfoHash.js';
import { Label } from '../../domain/torrent/Label.js';
import { AccountType } from '../../domain/user/AccountType.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { HashedPassword } from '../../domain/user/HashedPassword.js';
import { ProxyPort } from '../../domain/user/Port.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import type { TorrentUseCases, UseCases } from '../useCases.js';

// The only privileged consumer. Payloads were schema-checked at enqueue and at
// claim; reconstructing Value Objects here is the final, authoritative gate.
export class JobWorker {
  constructor(
    private readonly queue: JobQueuePort,
    private readonly useCases: UseCases,
    private readonly torrents: TorrentUseCases,
  ) {}

  async processNext(): Promise<boolean> {
    const claimed = await this.queue.claimNextPending();
    if (!claimed) {
      return false;
    }
    try {
      await this.execute(claimed.job);
      await this.queue.markDone(claimed.id);
      await this.chainAfter(claimed.job);
    } catch (error) {
      await this.queue.markFailed(
        claimed.id,
        error instanceof Error ? error.message : String(error),
      );
    }
    return true;
  }

  async drain(): Promise<number> {
    let count = 0;
    while (await this.processNext()) {
      count += 1;
    }
    return count;
  }

  // User Management -> Torrent Lifecycle stays decoupled: the worker reacts
  // to a completed user job by enqueueing the torrent-side follow-up.
  private async chainAfter(job: Job): Promise<void> {
    if (job.type === 'create-user') {
      await this.queue.enqueue(parseJob('provision-rtorrent', { username: job.payload.username }));
    }
    if (job.type === 'delete-user') {
      await this.queue.enqueue(
        parseJob('deprovision-rtorrent', { username: job.payload.username }),
      );
    }
  }

  private async execute(job: Job): Promise<void> {
    switch (job.type) {
      case 'create-user':
        await this.useCases.createUser.execute({
          username: Username.parse(job.payload.username),
          email: EmailAddress.parse(job.payload.email),
          accountType: AccountType.parse(job.payload.accountType),
          quota: Quota.bytes(job.payload.quotaBytes),
          proxyPort: ProxyPort.parse(job.payload.proxyPort),
          passwordHash: HashedPassword.parse(job.payload.passwordHash),
        });
        return;
      case 'delete-user':
        await this.useCases.deleteUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'change-password':
        await this.useCases.changePassword.execute({
          username: Username.parse(job.payload.username),
          passwordHash: HashedPassword.parse(job.payload.passwordHash),
        });
        return;
      case 'suspend-user':
        await this.useCases.suspendUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'resume-user':
        await this.useCases.resumeUser.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'provision-rtorrent':
        await this.torrents.provision.execute({ username: Username.parse(job.payload.username) });
        return;
      case 'deprovision-rtorrent':
        await this.torrents.deprovision.execute({
          username: Username.parse(job.payload.username),
        });
        return;
      case 'render-rtorrent-config':
        await this.torrents.render.execute({ username: Username.parse(job.payload.username) });
        return;
      case 'add-watch-dir':
        await this.torrents.addWatchDir.execute({
          username: Username.parse(job.payload.username),
          label: Label.parse(job.payload.label),
        });
        return;
      case 'set-sync-disabled':
        await this.torrents.setSyncDisabled.execute({
          username: Username.parse(job.payload.username),
          disabled: job.payload.disabled,
        });
        return;
      case 'set-allow-public-tracker':
        await this.torrents.setAllowPublicTracker.execute({
          username: Username.parse(job.payload.username),
          allowed: job.payload.allowed,
        });
        return;
      case 'torrent-event':
        await this.torrents.handleEvent.execute({
          username: Username.parse(job.payload.username),
          event: EventHook.parse(job.payload.event).type,
          infoHash: InfoHash.parse(job.payload.infoHash),
          ...(job.payload.name !== undefined && { name: job.payload.name }),
          ...(job.payload.directory !== undefined && { directory: job.payload.directory }),
          ...(job.payload.basePath !== undefined && { basePath: job.payload.basePath }),
          ...(job.payload.torrentFile !== undefined && { torrentFile: job.payload.torrentFile }),
          ...(job.payload.label !== undefined && { label: Label.parse(job.payload.label) }),
        });
        return;
    }
  }
}
