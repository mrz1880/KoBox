import type { LoggableService } from '../../domain/maintenance/ManagedService.js';

export interface ServiceLogSnapshot {
  readonly unit: string;
  readonly content: string;
  readonly capturedAt: string;
}

// Reads a unit's recent journal. Root-side: the portal has no journal access,
// and giving it any would widen a process whose whole design is zero-privilege.
export interface ServiceLogPort {
  tail(service: LoggableService, lines: number): Promise<string>;
}

export interface PackageUpdateSnapshot {
  readonly listing: string;
  readonly upgradableCount: number;
  readonly checkedAt: string;
}

export interface PackageUpdatePort {
  // refreshes the index, then reports what apt considers upgradable
  listUpgradable(): Promise<{ readonly listing: string; readonly count: number }>;
  // applies them; returns the tail of the output so the outcome is not invisible
  upgradeAll(): Promise<string>;
}

export interface DiagnosticsRepositoryPort {
  saveLog(snapshot: ServiceLogSnapshot): Promise<void>;
  findLog(unit: string): Promise<ServiceLogSnapshot | undefined>;
  savePackages(snapshot: PackageUpdateSnapshot): Promise<void>;
  findPackages(): Promise<PackageUpdateSnapshot | undefined>;
}
