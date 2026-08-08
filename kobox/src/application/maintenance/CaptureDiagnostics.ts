import type { LoggableService } from '../../domain/maintenance/ManagedService.js';
import type {
  DiagnosticsRepositoryPort,
  PackageUpdatePort,
  ServiceLogPort,
} from './DiagnosticsPort.js';

const LOG_LINES = 200;

interface LogDeps {
  readonly logs: ServiceLogPort;
  readonly repo: DiagnosticsRepositoryPort;
  readonly clock: () => string;
}

// Captures a unit's recent journal into the database, so the admin screen can
// show it without the portal ever reading a log itself. The capture time is
// stored alongside: a stale excerpt must be visibly stale.
export class CaptureServiceLog {
  constructor(private readonly deps: LogDeps) {}

  async execute(service: LoggableService): Promise<void> {
    const content = await this.deps.logs.tail(service, LOG_LINES);
    await this.deps.repo.saveLog({
      unit: service.value,
      content,
      capturedAt: this.deps.clock(),
    });
  }
}

interface PackageDeps {
  readonly packages: PackageUpdatePort;
  readonly repo: DiagnosticsRepositoryPort;
  readonly clock: () => string;
}

export class CheckPackageUpdates {
  constructor(private readonly deps: PackageDeps) {}

  async execute(): Promise<void> {
    const { listing, count } = await this.deps.packages.listUpgradable();
    await this.deps.repo.savePackages({
      listing,
      upgradableCount: count,
      checkedAt: this.deps.clock(),
    });
  }
}

// Applies the pending upgrades, then re-checks so the screen reflects reality
// instead of the list that was there before.
export class ApplyPackageUpdates {
  constructor(private readonly deps: PackageDeps) {}

  async execute(): Promise<void> {
    await this.deps.packages.upgradeAll();
    await new CheckPackageUpdates(this.deps).execute();
  }
}
