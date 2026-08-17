import { AppToken } from '../../domain/portal/AppToken.js';
import type { PortalCredentialsPort, SessionTokenPort } from '../../domain/portal/ports.js';
import type { Username } from '../../domain/user/Username.js';

interface Deps {
  readonly credentials: PortalCredentialsPort;
  readonly tokens: SessionTokenPort;
  readonly clock: () => string;
}

// Issues the credential a member gives to a machine — a download client, a
// script, a phone app. Only its sha256 is kept, so the raw value exists on the
// page that issued it and nowhere else afterwards: KoBox cannot show it again,
// which is the point.
export class IssueAppToken {
  constructor(private readonly deps: Deps) {}

  // Returns the raw token exactly once. Issuing again replaces the previous one,
  // so a member who lost theirs recovers without an admin.
  async execute(username: Username): Promise<AppToken | undefined> {
    const stored = await this.deps.credentials.find(username);
    if (stored === undefined) {
      return undefined;
    }
    const token = AppToken.parse(this.deps.tokens.generate());
    await this.deps.credentials.save(
      { ...stored, appTokenHash: this.deps.tokens.hashToken(token.reveal()) },
      this.deps.clock(),
    );
    return token;
  }

  async revoke(username: Username): Promise<void> {
    const stored = await this.deps.credentials.find(username);
    if (stored === undefined) {
      return;
    }
    // rebuilt without the key: with exactOptionalPropertyTypes, absent and
    // undefined are different, and "no token" is the absent one
    await this.deps.credentials.save(
      {
        username: stored.username,
        passwordHash: stored.passwordHash,
        role: stored.role,
        ...(stored.mustChangePassword !== undefined && {
          mustChangePassword: stored.mustChangePassword,
        }),
      },
      this.deps.clock(),
    );
  }
}
