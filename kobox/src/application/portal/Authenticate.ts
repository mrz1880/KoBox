import type { Role } from '../../domain/portal/Role.js';
import type {
  PortalCredentialsPort,
  SessionStorePort,
  SessionTokenPort,
} from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';
import type { UserRepository } from '../../domain/user/ports.js';

export interface AuthenticatedSession {
  readonly username: Username;
  readonly role: Role;
  readonly csrfToken: string;
  // Phase 7: a migrated user on a temporary password. The portal forces a
  // password change before granting any other access while this is true.
  readonly mustChangePassword: boolean;
}

interface Deps {
  readonly users: UserRepository;
  readonly credentials: PortalCredentialsPort;
  readonly sessions: SessionStorePort;
  readonly tokens: SessionTokenPort;
}

// Every request goes through here (pages, downloads and the nginx
// auth_request subrequests for /ru and /RPC-*). Role is re-read from the
// credential row so a demotion applies to live sessions immediately.
export class Authenticate {
  constructor(private readonly deps: Deps) {}

  async execute(command: {
    readonly token: string;
    readonly now: string;
  }): Promise<AuthenticatedSession | undefined> {
    const { users, credentials, sessions, tokens } = this.deps;

    const session = await sessions.find(tokens.hashToken(command.token));
    if (session === undefined) {
      return undefined;
    }
    if (session.expiresAt <= command.now) {
      await sessions.delete(session.id);
      return undefined;
    }

    const user = await users.findByUsername(session.username);
    if (user === undefined || user.status.isSuspended()) {
      return undefined;
    }
    const stored = await credentials.find(session.username);
    if (stored === undefined) {
      return undefined;
    }

    return {
      username: session.username,
      role: stored.role,
      csrfToken: session.csrfToken,
      mustChangePassword: stored.mustChangePassword === true,
    };
  }
}
