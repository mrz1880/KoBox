import type { TrackerRepository } from '../../domain/tracker/ports.js';
import type { FetchTrackerCert } from './FetchTrackerCert.js';

export interface RenewTrackerCertsCommand {
  readonly today: string; // YYYY-MM-DD
  readonly now: string; // YYYY-MM-DD HH:MM:SS
}

export interface RenewalReport {
  readonly checked: number;
  readonly promoted: number;
  readonly failed: number;
}

interface Deps {
  readonly trackers: TrackerRepository;
  readonly fetchCert: FetchTrackerCert;
}

// The cron entry point (legacy GetTrackersCert.bsh): every due tracker is
// checked, failures are isolated — one broken tracker never blocks the rest.
export class RenewTrackerCerts {
  constructor(private readonly deps: Deps) {}

  async execute(command: RenewTrackerCertsCommand): Promise<RenewalReport> {
    const due = await this.deps.trackers.listNeedingCertCheck(command.today);
    let promoted = 0;
    let failed = 0;
    for (const tracker of due) {
      try {
        const report = await this.deps.fetchCert.execute({
          host: tracker.host,
          now: command.now,
        });
        if (report.promoted) {
          promoted += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { checked: due.length, promoted, failed };
  }
}
