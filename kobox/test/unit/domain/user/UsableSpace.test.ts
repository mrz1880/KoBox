import { describe, expect, it } from 'vitest';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { UsableSpace } from '../../../../src/domain/user/UsableSpace.js';
import { VolumeSpace } from '../../../../src/domain/user/VolumeSpace.js';

const disk = (freeGib: number): VolumeSpace =>
  VolumeSpace.of({ free: Quota.gib(freeGib), size: Quota.gib(3400) });

describe('UsableSpace', () => {
  it('should_leave_what_the_allowance_still_holds_while_the_disk_has_more', () => {
    const usable = UsableSpace.of({
      allowance: Quota.gib(400),
      used: Quota.gib(188),
      volume: disk(1000),
    });

    expect(usable.free.toGib()).toBe(212);
    expect(usable.limit).toBe('allowance');
  });

  // the allowances add up to more than the disk, so the disk can run out
  // before a member reaches theirs
  it('should_leave_only_what_the_disk_still_has_once_it_holds_less', () => {
    const usable = UsableSpace.of({
      allowance: Quota.gib(400),
      used: Quota.gib(188),
      volume: disk(50),
    });

    expect(usable.free.toGib()).toBe(50);
    expect(usable.limit).toBe('disk');
  });

  // lowering an allowance below what a member stores deletes nothing, so the
  // disk can hold more than the allowance: nothing is left, never less
  it('should_leave_nothing_to_a_member_already_over_their_allowance', () => {
    const usable = UsableSpace.of({
      allowance: Quota.gib(400),
      used: Quota.gib(450),
      volume: disk(1000),
    });

    expect(usable.free.toBytes()).toBe(0);
    expect(usable.limit).toBe('allowance');
  });
});
