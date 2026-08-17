import { AppToken } from '../../domain/portal/AppToken.js';
import { isLocked, lockExpiry, MAX_LOGIN_FAILURES } from '../../domain/portal/policy.js';
import type {
  LoginAttemptsPort,
  PortalCredentialsPort,
  SessionTokenPort,
} from '../../domain/portal/ports.js';
import type { Role } from '../../domain/portal/Role.js';
import { Username } from '../../domain/user/Username.js';

export interface AuthenticatedApp {
  readonly username: Username;
  readonly role: Role;
}

interface Deps {
  readonly credentials: PortalCredentialsPort;
  readonly attempts: LoginAttemptsPort;
  readonly tokens: SessionTokenPort;
  readonly clock: () => string;
}

// A machine presenting HTTP Basic: Radarr and Sonarr drive rTorrent through
// ruTorrent's httprpc endpoint, and a download client has no cookie and no way
// to get one. MySB accepted the account password here; KoBox accepts a token
// instead, so a leaked client config costs the member that token and not their
// portal account.
//
// The token is compared by its sha256, the same treatment sessions get: it is
// 32 bytes of CSPRNG, so a fast hash is right: a slow KDF protects a guessable
// secret, and this one is not guessable.
export class AuthenticateApp {
  constructor(private readonly deps: Deps) {}

  async execute(command: {
    readonly username: string;
    readonly token: string;
  }): Promise<AuthenticatedApp | undefined> {
    let username: Username;
    let token: AppToken;
    try {
      username = Username.parse(command.username);
      token = AppToken.parse(command.token);
    } catch {
      return undefined;
    }

    // the SAME lockout the login form uses, from the same domain policy: two
    // doors onto the same accounts must not have two different thresholds, and
    // this one would otherwise be the unrated way in
    const attempt = await this.deps.attempts.get(username);
    if (isLocked(attempt?.lockedUntil, this.deps.clock())) {
      return undefined;
    }

    const stored = await this.deps.credentials.find(username);
    if (stored?.appTokenHash === undefined) {
      await this.recordFailure(username);
      return undefined;
    }
    // a member still on a temporary password has not proven who they are yet
    if (stored.mustChangePassword === true) {
      return undefined;
    }
    if (this.deps.tokens.hashToken(token.reveal()) !== stored.appTokenHash) {
      await this.recordFailure(username);
      return undefined;
    }

    await this.deps.attempts.clear(username);
    return { username, role: stored.role };
  }

  private async recordFailure(username: Username): Promise<void> {
    const current = await this.deps.attempts.get(username);
    const failures = (current?.failures ?? 0) + 1;
    await this.deps.attempts.save({
      username,
      failures,
      ...(failures >= MAX_LOGIN_FAILURES && { lockedUntil: lockExpiry(this.deps.clock()) }),
    });
  }
}
