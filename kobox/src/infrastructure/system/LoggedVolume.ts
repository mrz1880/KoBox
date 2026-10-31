import type { VolumeSpace } from '../../domain/user/VolumeSpace.js';
import type { VolumePort } from '../../domain/user/ports.js';

interface WarnLog {
  warn(details: { readonly reason: string }, message: string): void;
}

// Writes every failed volume reading to the worker log. The hourly pass skips
// it so each member still gets their reading, and the portal keeps showing the
// last disk line: without the log, nothing would say why it stopped moving.
export class LoggedVolume implements VolumePort {
  constructor(
    private readonly volume: VolumePort,
    private readonly log: WarnLog,
  ) {}

  async measure(): Promise<VolumeSpace> {
    try {
      return await this.volume.measure();
    } catch (error) {
      this.log.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        'volume reading failed',
      );
      throw error;
    }
  }
}
