import type { RenderedFile } from '../shared/files.js';
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

// Unit lifecycle for installers. Distinct from the per-user ServiceControlPort
// (user domain): here units are named directly and enable/disable matters.
export interface SystemdPort {
  daemonReload(): Promise<void>;
  enable(unit: string, opts?: { readonly now?: boolean }): Promise<void>;
  disable(unit: string, opts?: { readonly now?: boolean }): Promise<void>;
  start(unit: string): Promise<void>;
  stop(unit: string): Promise<void>;
  reloadOrRestart(unit: string): Promise<void>;
  isActive(unit: string): Promise<boolean>;
}

export type ConfigCheckResult = { readonly ok: true } | { readonly ok: false; readonly detail: string };

// The anti-brick validators: a rendered config is only kept when the
// service's own checker accepts it (sshd -t, nginx -t, named-checkconf).
export interface ConfigCheckPort {
  sshd(): Promise<ConfigCheckResult>;
  nginx(): Promise<ConfigCheckResult>;
  bind(): Promise<ConfigCheckResult>;
}

// Small host mutations installers need beyond packages/files/units. The one
// anti-corruption seam to Debian for installation; every op stays argv-only
// or plain fs in the adapter.
export interface InstallHostPort {
  hostname(): Promise<string>;
  pathExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string | undefined>;
  removeFile(path: string): Promise<void>;
  ensureDir(path: string, mode: string): Promise<void>;
  // creates the file only when absent; returns true when it was created
  ensureFile(file: RenderedFile): Promise<boolean>;
  // creates the symlink only when absent; returns true when it was created
  ensureSymlink(linkPath: string, target: string): Promise<boolean>;
  extractTarGz(archive: string, destDir: string): Promise<void>;
  applySysctl(): Promise<void>;
  postconf(settings: Readonly<Record<string, string>>): Promise<void>;
  postmap(path: string): Promise<void>;
  preseedDebconf(selections: readonly string[]): Promise<void>;
  mountOptions(mountPoint: string): Promise<readonly string[]>;
  activateQuota(mountPoint: string): Promise<void>;
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
  list(): Promise<readonly ComponentRecord[]>;
  get(name: ComponentName): Promise<ComponentRecord | undefined>;
  markInstalled(name: ComponentName, version: Version | undefined, now: string): Promise<void>;
  markFailed(name: ComponentName, reason: string, now: string): Promise<void>;
  markSkipped(name: ComponentName, reason: string, now: string): Promise<void>;
  reset(name: ComponentName, now: string): Promise<void>;
}
