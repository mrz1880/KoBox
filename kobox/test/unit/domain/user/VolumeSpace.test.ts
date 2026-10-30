import { describe, expect, it } from 'vitest';
import { Quota } from '../../../../src/domain/user/Quota.js';
import {
  InvalidVolumeSpaceError,
  VolumeSpace,
} from '../../../../src/domain/user/VolumeSpace.js';

describe('VolumeSpace', () => {
  it('should_refuse_a_reading_with_more_free_space_than_the_disk_holds', () => {
    expect(() => VolumeSpace.of({ free: Quota.gib(11), size: Quota.gib(10) })).toThrow(
      InvalidVolumeSpaceError,
    );
  });

  it('should_accept_a_full_disk_and_an_empty_one', () => {
    expect(VolumeSpace.of({ free: Quota.gib(0), size: Quota.gib(10) }).free.toGib()).toBe(0);
    expect(VolumeSpace.of({ free: Quota.gib(10), size: Quota.gib(10) }).size.toGib()).toBe(10);
  });
});
