import type { Quota } from './Quota.js';
import type { VolumeSpace } from './VolumeSpace.js';

// Which of the two limits stops a member first.
export type SpaceLimit = 'allowance' | 'disk';

// How much a member can still fill: the smaller of what their allowance still
// holds and what the disk still has. The allowances can add up to more than
// the disk, so the allowance alone can promise space that is not there; the
// limit that binds says which of the two the member is up against. On a tie
// the allowance is named: the disk only binds when it holds strictly less.
export class UsableSpace {
  private constructor(
    readonly free: Quota,
    readonly limit: SpaceLimit,
  ) {}

  static of(member: {
    readonly allowance: Quota;
    readonly used: Quota;
    readonly volume: VolumeSpace;
  }): UsableSpace {
    const leftInAllowance = member.allowance.remainingAfter(member.used);
    return leftInAllowance.fitsWithin(member.volume.free)
      ? new UsableSpace(leftInAllowance, 'allowance')
      : new UsableSpace(member.volume.free, 'disk');
  }
}
