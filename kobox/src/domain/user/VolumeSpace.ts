import { DomainError } from '../shared/DomainError.js';
import type { Quota } from './Quota.js';

export class InvalidVolumeSpaceError extends DomainError {
  constructor(free: Quota, size: Quota) {
    super(`invalid volume reading: ${free.toString()} free on a ${size.toString()} disk`);
  }
}

// The filesystem that holds the members' homes, as the hourly pass found it.
// Quotas are promises each member gets on their own; this is what the disk can
// actually still give all of them together.
export class VolumeSpace {
  private constructor(
    readonly free: Quota,
    readonly size: Quota,
  ) {}

  static of(reading: { readonly free: Quota; readonly size: Quota }): VolumeSpace {
    if (!reading.free.fitsWithin(reading.size)) {
      throw new InvalidVolumeSpaceError(reading.free, reading.size);
    }
    return new VolumeSpace(reading.free, reading.size);
  }
}
