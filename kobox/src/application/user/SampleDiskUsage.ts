import type {
  DiskUsageRepository,
  QuotaGaugePort,
  QuotaPort,
  UserRepository,
  VolumePort,
  VolumeSampleRepository,
} from '../../domain/user/ports.js';

interface Deps {
  readonly repo: UserRepository;
  readonly quota: QuotaPort;
  readonly samples: DiskUsageRepository;
  readonly gauges: QuotaGaugePort;
  readonly volume: VolumePort;
  readonly volumeSamples: VolumeSampleRepository;
  readonly clock: () => string;
}

// Writes down what the disk holds for each member, on a schedule, because the
// portal runs non-root and cannot ask about an account that is not its own.
// One member's unreadable quota must not cost the others their reading, so a
// failure is skipped rather than propagated. The volume all of them share is
// read once per pass, and an unreadable volume is skipped the same way.
export class SampleDiskUsage {
  constructor(private readonly deps: Deps) {}

  async execute(): Promise<void> {
    const at = this.deps.clock();
    const space = await this.deps.volume.measure().catch(() => undefined);
    if (space !== undefined) {
      await this.deps.volumeSamples.save({ space, measuredAt: at });
    }
    for (const user of await this.deps.repo.listAll()) {
      const used = await this.deps.quota.getUsage(user.username).catch(() => undefined);
      if (used === undefined) {
        continue;
      }
      await this.deps.samples.save({ username: user.username, used, sampledAt: at });
      await this.deps.gauges.show(user.username, used, user.quota);
    }
  }
}
