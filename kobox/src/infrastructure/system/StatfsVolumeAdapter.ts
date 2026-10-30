import { statfs } from 'node:fs/promises';
import { Quota } from '../../domain/user/Quota.js';
import type { VolumePort } from '../../domain/user/ports.js';
import { VolumeSpace } from '../../domain/user/VolumeSpace.js';

// Reads the filesystem that holds `path`. Free is the blocks an ordinary
// account may still write (bavail), not the ones reserved for root: members are
// ordinary accounts, and it is what df calls "Available".
export class StatfsVolumeAdapter implements VolumePort {
  constructor(private readonly path: string) {}

  async measure(): Promise<VolumeSpace> {
    const stats = await statfs(this.path);
    return VolumeSpace.of({
      free: Quota.bytes(stats.bavail * stats.bsize),
      size: Quota.bytes(stats.blocks * stats.bsize),
    });
  }
}
