import type { ComponentName } from './ComponentName.js';
import type { InstallState } from './InstallState.js';
import type { Version } from './Version.js';

// Read-only facts about the host, gathered BEFORE any mutation. hasTunDevice
// is not a preflight gate — the openvpn installer uses it to decide whether
// tunnels can actually start (containers usually lack /dev/net/tun).
export interface SystemFacts {
  readonly osId: string;
  readonly osVersionId: string;
  readonly arch: string;
  readonly euid: number;
  readonly rootFsType: string;
  readonly hasDefaultRoute: boolean;
  readonly hasTunDevice: boolean;
}

export interface SystemFactsPort {
  gather(): Promise<SystemFacts>;
}

// apt behind a port: installers declare desired packages, the adapter keeps
// the calls argv-only and skips work already done (fast idempotent re-runs).
export interface PackagePort {
  refresh(): Promise<void>;
  ensureInstalled(packages: readonly string[]): Promise<void>;
  isAvailable(pkg: string): Promise<boolean>;
  isInstalled(pkg: string): Promise<boolean>;
  installedVersion(pkg: string): Promise<string | undefined>;
}

// §5.6 verified downloads: bytes reach destPath only after the sha256
// matches; anything else throws and leaves no partial file behind.
export interface ArtifactFetchPort {
  fetchVerified(url: string, sha256: string, destPath: string): Promise<void>;
}

export interface ComponentRecord {
  readonly name: ComponentName;
  readonly state: InstallState;
  readonly version?: Version;
  readonly reason?: string;
  readonly installedAt?: string;
}

// The durable install registry: every attempt leaves a truthful row, which is
// what makes re-runs resumable (planInstallation reads states()).
export interface ComponentRegistry {
  states(): Promise<ReadonlyMap<string, InstallState>>;
  get(name: ComponentName): Promise<ComponentRecord | undefined>;
  markInstalled(name: ComponentName, version: Version | undefined, now: string): Promise<void>;
  markFailed(name: ComponentName, reason: string, now: string): Promise<void>;
  markSkipped(name: ComponentName, reason: string, now: string): Promise<void>;
  reset(name: ComponentName, now: string): Promise<void>;
}
