import type { Speedtest } from '../../domain/maintenance/speedtest.js';

// Measures what the link can carry. Saturates it by design, so this is only
// ever driven by an explicit operator request — never on a schedule.
export interface SpeedtestPort {
  measure(now: string): Promise<Speedtest>;
}

export interface SpeedtestRepositoryPort {
  save(result: Speedtest): Promise<Speedtest>;
  // newest first; the series is the point, not any single figure
  listRecent(limit: number): Promise<readonly Speedtest[]>;
}
