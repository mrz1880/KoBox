import type {
  DiskUsageRepository,
  QuotaPort,
  UserRepository,
} from '../../domain/user/ports.js';

interface Deps {
  readonly repo: UserRepository;
  readonly quota: QuotaPort;
  readonly samples: DiskUsageRepository;
  readonly clock: () => string;
}

// Writes down what the disk holds for each member, on a schedule, because the
// portal runs non-root and cannot ask about an account that is not its own.
// One member's unreadable quota must not cost the others their reading, so a
// failure is skipped rather than propagated.
export class SampleDiskUsage {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const at = this.deps.clock();
    for (const user of await this.deps.repo.listAll()) {
      const used = await this.deps.quota.getUsage(user.username).catch(() => undefined);
      if (used === undefined) {
        continue;
      }
      await this.deps.samples.save({ username: user.username, used, sampledAt: at });
    }
  }
}
