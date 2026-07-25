import type { HashedPassword } from './HashedPassword.js';
import type { Password } from './Password.js';
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

// Plaintext never crosses this boundary: passwords arrive pre-hashed so the
// persisted job queue and process argv only ever see crypt(3) hashes.
export interface SystemAccountPort {
  createAccount(username: Username): Promise<void>;
  deleteAccount(username: Username): Promise<void>;
  setPassword(username: Username, hash: HashedPassword): Promise<void>;
  // lock must block ALL auth paths (password AND ssh keys) — reversibly
  lockAccount(username: Username): Promise<void>;
  unlockAccount(username: Username): Promise<void>;
  terminateSessions(username: Username): Promise<void>;
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

// Owned jointly with the Torrent Lifecycle context: Phase 0 drives
// stop/start on suspend/resume, Phase 1 provisions the unit itself
// (install/remove/restart with declarative, write-if-changed content).
export interface ServiceControlPort {
  stopUserService(username: Username): Promise<void>;
  startUserService(username: Username): Promise<void>;
  isUserServiceRunning(username: Username): Promise<boolean>;
  installUserService(username: Username, unitContent: string): Promise<void>;
  removeUserService(username: Username): Promise<void>;
  restartUserService(username: Username): Promise<void>;
}

// Hashing happens at the unprivileged boundary (CLI/web) so plaintext dies there.
// verify() re-hashes the candidate with the stored salt and compares in
// constant time — the portal login path (Phase 6).
export interface PasswordHasherPort {
  hash(password: Password): Promise<HashedPassword>;
  verify(password: Password, hash: HashedPassword): Promise<boolean>;
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

// Real probes (process alive, socket connects) — systemd "active" is not proof
// (crashed rtorrent still "active", Minio failed silently for 10 h).
export interface HealthProbePort {
  checkProcess(processName: string): Promise<HealthCheckResult>;
  checkSocket(host: string, port: number): Promise<HealthCheckResult>;
}
