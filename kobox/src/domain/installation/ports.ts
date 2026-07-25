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
