import type { HashedPassword } from '../user/HashedPassword.js';
import type { Username } from '../user/Username.js';
import type { Role } from './Role.js';

// Portal login credentials: the same crypt(3) sha512 hash the system account
// receives, mirrored by the ROOT WORKER on create-user/change-password (the
// unprivileged portal only ever reads it to verify a login).
export interface PortalCredentials {
  readonly username: Username;
  readonly passwordHash: HashedPassword;
  readonly role: Role;
  // Phase 7: set when a migrated user is given a temporary password — the
  // portal forces a password change before granting access. Defaults to false.
  readonly mustChangePassword?: boolean;
  // sha256 of the member's app token, when they have issued one. Machines
  // present it as HTTP Basic; the raw token only ever exists on the page that
  // showed it once, so a database read never yields a usable credential.
  readonly appTokenHash?: string;
}

export interface PortalCredentialsPort {
  find(username: Username): Promise<PortalCredentials | undefined>;
  save(credentials: PortalCredentials, now: string): Promise<void>;
  delete(username: Username): Promise<void>;
}

// Server-side session row. `id` is the sha256 hex of the bearer token — the
// raw token only ever lives in the user's cookie, so a DB read never yields a
// usable session (anti-AUDIT §5.5 "sessions en clair").
export interface PortalSessionRecord {
  readonly id: string;
  readonly username: Username;
  readonly csrfToken: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface SessionStorePort {
  create(session: PortalSessionRecord): Promise<void>;
  find(id: string): Promise<PortalSessionRecord | undefined>;
  delete(id: string): Promise<void>;
  deleteForUser(username: Username): Promise<void>;
  purgeExpired(now: string): Promise<number>;
}

export interface LoginAttempt {
  readonly username: Username;
  readonly failures: number;
  readonly lockedUntil?: string;
}

export interface LoginAttemptsPort {
  get(username: Username): Promise<LoginAttempt | undefined>;
  save(attempt: LoginAttempt): Promise<void>;
  clear(username: Username): Promise<void>;
}

// Token material: generation needs a CSPRNG and hashing needs sha256, both
// infrastructure concerns behind this port. The raw token goes to the cookie;
// only its hash is ever stored or looked up.
export interface SessionTokenPort {
  generate(): string;
  hashToken(token: string): string;
}
