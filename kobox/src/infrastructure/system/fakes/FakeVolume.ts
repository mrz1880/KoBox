import { Quota } from '../../../domain/user/Quota.js';
import type { VolumePort } from '../../../domain/user/ports.js';
import { VolumeSpace } from '../../../domain/user/VolumeSpace.js';

export class FakeVolume implements VolumePort {
  private space = VolumeSpace.of({ free: Quota.bytes(0), size: Quota.bytes(0) });
  private failure: string | undefined;
  private reads = 0;

  setSpaceForTest(space: VolumeSpace): void {
    this.space = space;
  }

  failWith(message: string): void {
    this.failure = message;
  }

  get readCount(): number {
    return this.reads;
  }

  measure(): Promise<VolumeSpace> {
    this.reads += 1;
    return this.failure === undefined
      ? Promise.resolve(this.space)
      : Promise.reject(new Error(this.failure));
  }
}
