import type { Speedtest } from '../../domain/maintenance/speedtest.js';
import type { SpeedtestRepositoryPort } from '../../application/maintenance/SpeedtestPort.js';

export class InMemorySpeedtestRepository implements SpeedtestRepositoryPort {
  private readonly rows: Speedtest[] = [];
  private seq = 0;

  save(result: Speedtest): Promise<Speedtest> {
    const saved = result.identifiedBy((this.seq += 1));
    this.rows.unshift(saved);
    return Promise.resolve(saved);
  }

  listRecent(limit: number): Promise<readonly Speedtest[]> {
    return Promise.resolve(this.rows.slice(0, limit));
  }
}
