import { Quota } from '../../domain/user/Quota.js';
import type { QuotaPort } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

export class QuotaAdapter implements QuotaPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly filesystem: string,
  ) {}

  async setQuota(username: Username, quota: Quota): Promise<void> {
    const blocksKib = Math.floor(quota.toBytes() / 1024);
    // hard block limit only (soft=0): the whole point vs the legacy soft-only
    await runOrThrow(this.runner, {
      command: 'setquota',
      args: ['-u', username.value, '0', String(blocksKib), '0', '0', this.filesystem],
    });
  }

  async getUsage(username: Username): Promise<Quota> {
    // exit 1 just means "over quota" for quota(1); tolerate it
    const result = await this.runner.run({
      command: 'quota',
      args: ['-u', '-w', username.value],
    });
    const dataLine = result.stdout
      .split('\n')
      .find((line) => line.trimStart().startsWith('/'));
    const blocksKib = Number(dataLine?.trim().split(/\s+/)[1]?.replace(/[*+]/g, '') ?? '0');
    return Quota.bytes(Number.isFinite(blocksKib) ? blocksKib * 1024 : 0);
  }
}

// For hosts/tests without quota-enabled filesystems: quota state still lives
// in the DB; enforcement is explicitly reported as skipped, never silent.
export class NoopQuotaAdapter implements QuotaPort {
  constructor(private readonly onSkip: (username: string) => void) {}

  setQuota(username: Username): Promise<void> {
    this.onSkip(username.value);
    return Promise.resolve();
  }

  getUsage(): Promise<Quota> {
    return Promise.resolve(Quota.bytes(0));
  }
}
