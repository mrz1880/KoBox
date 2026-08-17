import type { DiskUsageRepository, DiskUsageSample } from '../../domain/user/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryDiskUsageRepository implements DiskUsageRepository {
  private readonly samples = new Map<string, DiskUsageSample>();

  save(sample: DiskUsageSample): Promise<void> {
    this.samples.set(sample.username.value, sample);
    return Promise.resolve();
  }

  find(username: Username): Promise<DiskUsageSample | undefined> {
    return Promise.resolve(this.samples.get(username.value));
  }
}
