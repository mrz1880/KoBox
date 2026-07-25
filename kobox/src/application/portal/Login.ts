import type { Role } from '../../domain/portal/Role.js';
import {
  isLocked,
  lockExpiry,
  MAX_LOGIN_FAILURES,
  sessionExpiry,
} from '../../domain/portal/policy.js';
import type {
  LoginAttemptsPort,
  PortalCredentialsPort,
  SessionStorePort,
  SessionTokenPort,
} from '../../domain/portal/ports.js';
import type { Password } from '../../domain/user/Password.js';
import type { Username } from '../../domain/user/Username.js';
import type { PasswordHasherPort, UserRepository } from '../../domain/user/ports.js';

export interface LoginCommand {
  readonly username: Username;
  readonly password: Password;
  readonly now: string;
}

export type LoginResult =
  | { readonly ok: true; readonly token: string; readonly csrfToken: string; readonly role: Role }
  | { readonly ok: false; readonly reason: 'invalid-credentials' | 'locked' | 'suspended' };

interface Deps {
  readonly users: UserRepository;
  readonly credentials: PortalCredentialsPort;
  readonly sessions: SessionStorePort;
  readonly attempts: LoginAttemptsPort;
  readonly tokens: SessionTokenPort;
  readonly hasher: PasswordHasherPort;
}

// The application replacement for the legacy shared Basic Auth (AUDIT §5.5):
// per-user verification, timed lockout, server-side session, CSRF secret.
export class Login {
  constructor(private readonly deps: Deps) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const { users, credentials, sessions, attempts, tokens, hasher } = this.deps;
    const { username, password, now } = command;

    const attempt = await attempts.get(username);
    if (isLocked(attempt?.lockedUntil, now)) {
      return { ok: false, reason: 'locked' };
    }

    const user = await users.findByUsername(username);
    if (user?.status.isSuspended() === true) {
      return { ok: false, reason: 'suspended' };
    }

    const stored = await credentials.find(username);
    if (user === undefined || stored === undefined) {
      // count the miss anyway: username probing costs like password probing
      await this.recordFailure(username, attempt?.failures ?? 0, now);
      return { ok: false, reason: 'invalid-credentials' };
    }

    if (!(await hasher.verify(password, stored.passwordHash))) {
      await this.recordFailure(username, attempt?.failures ?? 0, now);
      return { ok: false, reason: 'invalid-credentials' };
    }

    await attempts.clear(username);
    const token = tokens.generate();
    const csrfToken = tokens.generate();
    await sessions.create({
      id: tokens.hashToken(token),
      username,
      csrfToken,
      createdAt: now,
      expiresAt: sessionExpiry(now),
    });
    return { ok: true, token, csrfToken, role: stored.role };
  }

  private async recordFailure(username: Username, failures: number, now: string): Promise<void> {
    const next = failures + 1;
    await this.deps.attempts.save({
      username,
      failures: next,
      ...(next >= MAX_LOGIN_FAILURES && { lockedUntil: lockExpiry(now) }),
    });
  }
}
