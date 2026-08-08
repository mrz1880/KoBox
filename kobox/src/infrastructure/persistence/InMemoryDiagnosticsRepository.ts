import type {
  DiagnosticsRepositoryPort,
  PackageUpdateSnapshot,
  ServiceLogSnapshot,
} from '../../application/maintenance/DiagnosticsPort.js';

export class InMemoryDiagnosticsRepository implements DiagnosticsRepositoryPort {
  private readonly byUnit = new Map<string, ServiceLogSnapshot>();
  private packages: PackageUpdateSnapshot | undefined;

  saveLog(snapshot: ServiceLogSnapshot): Promise<void> {
    this.byUnit.set(snapshot.unit, snapshot);
    return Promise.resolve();
  }

  findLog(unit: string): Promise<ServiceLogSnapshot | undefined> {
    return Promise.resolve(this.byUnit.get(unit));
  }

  savePackages(snapshot: PackageUpdateSnapshot): Promise<void> {
    this.packages = snapshot;
    return Promise.resolve();
  }

  findPackages(): Promise<PackageUpdateSnapshot | undefined> {
    return Promise.resolve(this.packages);
  }
}
