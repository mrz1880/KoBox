import type { Quota } from './Quota.js';
import type { SeedboxUser } from './SeedboxUser.js';
import type { UserEvent } from './events.js';
import type { Username } from './Username.js';

export interface UserRepository {
  findByUsername(username: Username): Promise<SeedboxUser | undefined>;
  listAll(): Promise<readonly SeedboxUser[]>;
  save(user: SeedboxUser): Promise<SeedboxUser>;
  delete(username: Username): Promise<void>;
}

// Secrets cross this boundary as opaque values and must never be logged.
export interface SystemAccountPort {
  createAccount(username: Username): Promise<void>;
  deleteAccount(username: Username): Promise<void>;
  setPassword(username: Username, password: string): Promise<void>;
  lockAccount(username: Username): Promise<void>;
  unlockAccount(username: Username): Promise<void>;
  accountExists(username: Username): Promise<boolean>;
  isLocked(username: Username): Promise<boolean>;
}

export interface QuotaPort {
  setQuota(username: Username, quota: Quota): Promise<void>;
  getUsage(username: Username): Promise<Quota>;
}

export interface SftpPort {
  enableChrootAccess(username: Username): Promise<void>;
  disableChrootAccess(username: Username): Promise<void>;
  isChrootAccessEnabled(username: Username): Promise<boolean>;
}

// Seam toward the Torrent Lifecycle context (Phase 1): Phase 0 only needs to
// stop/start the per-user rtorrent service on suspend/resume.
export interface ServiceControlPort {
  stopUserService(username: Username): Promise<void>;
  startUserService(username: Username): Promise<void>;
  isUserServiceRunning(username: Username): Promise<boolean>;
}

export interface NotificationPort {
  notify(event: UserEvent): Promise<void>;
}

export type HealthState = 'healthy' | 'unhealthy';

export interface HealthCheckResult {
  readonly name: string;
  readonly state: HealthState;
  readonly detail?: string;
}

// Real probes (process alive, socket connects) — systemd "active" lied in prod
// (crashed rtorrent still "active", Minio failed silently for 10 h).
export interface HealthProbePort {
  checkProcess(processName: string): Promise<HealthCheckResult>;
  checkSocket(host: string, port: number): Promise<HealthCheckResult>;
}
