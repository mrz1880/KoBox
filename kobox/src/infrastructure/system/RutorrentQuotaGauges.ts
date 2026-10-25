import { renderQuotaGauge } from '../../domain/installation/rendering.js';
import type { ManagedFilesPort } from '../../domain/shared/files.js';
import type { QuotaGaugePort } from '../../domain/user/ports.js';
import type { Quota } from '../../domain/user/Quota.js';
import type { Username } from '../../domain/user/Username.js';

// ruTorrent's disk meter reads each member's gauge from their profile folder:
// written here, by the root worker, after each disk usage sample.
export class RutorrentQuotaGauges implements QuotaGaugePort {
  constructor(private readonly files: ManagedFilesPort) {}

  async show(username: Username, used: Quota, quota: Quota): Promise<void> {
    await this.files.apply([renderQuotaGauge(username.value, used.toBytes(), quota.toBytes())]);
  }
}
