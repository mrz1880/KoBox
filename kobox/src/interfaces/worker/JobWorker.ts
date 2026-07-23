import type { Job } from '../../application/jobs/contract.js';
import type { JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import { AccountType } from '../../domain/user/AccountType.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import { HashedPassword } from '../../domain/user/HashedPassword.js';
import { ProxyPort } from '../../domain/user/Port.js';
import { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import type { UseCases } from '../useCases.js';

// The only privileged consumer. Payloads were schema-checked at enqueue and at
// claim; reconstructing Value Objects here is the final, authoritative gate.
export class JobWorker {
  constructor(
    private readonly queue: JobQueuePort,
    private readonly useCases: UseCases,
  ) {}

  async processNext(): Promise<boolean> {
    const claimed = await this.queue.claimNextPending();
    if (!claimed) {
      return false;
    }
    try {
      await this.execute(claimed.job);
      await this.queue.markDone(claimed.id);
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
    }
  }
}
