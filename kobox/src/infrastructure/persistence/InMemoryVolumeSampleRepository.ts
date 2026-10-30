import type { VolumeSample, VolumeSampleRepository } from '../../domain/user/ports.js';

export class InMemoryVolumeSampleRepository implements VolumeSampleRepository {
  private latest: VolumeSample | undefined;

  save(sample: VolumeSample): Promise<void> {
    this.latest = sample;
    return Promise.resolve();
  }

  find(): Promise<VolumeSample | undefined> {
    return Promise.resolve(this.latest);
  }
}
