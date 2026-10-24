import { parseJob } from '../jobs/contract.js';
import type { JobQueuePort } from '../jobs/JobQueuePort.js';
import type { MailOutboxPort } from '../maintenance/MailOutboxPort.js';
import { UserAlreadyExistsError, UserNotFoundError } from '../user/errors.js';
import { DomainError } from '../../domain/shared/DomainError.js';
import type { Language } from '../../domain/portal/Language.js';
import { PasswordLink, type PasswordLinkPurpose } from '../../domain/portal/PasswordLink.js';
import { shift } from '../../domain/portal/policy.js';
import type {
  PasswordLinkRepository,
  PortalCredentialsPort,
  SessionTokenPort,
} from '../../domain/portal/ports.js';
import type { Role } from '../../domain/portal/Role.js';
import { EmailAddress } from '../../domain/user/EmailAddress.js';
import type { Password } from '../../domain/user/Password.js';
import type { PasswordSealerPort, UserRepository } from '../../domain/user/ports.js';
import type { Quota } from '../../domain/user/Quota.js';
import { Username } from '../../domain/user/Username.js';
import { passwordLinkMail } from './passwordLinkMail.js';

// Where members reach the portal, as a link in a mail can name it.
export interface PortalAddressPort {
  baseUrl(): Promise<string>;
}

// More links than this in an hour is somebody hammering a member's mailbox.
const LINKS_PER_HOUR = 3;
const HOUR_MS = 60 * 60_000;
// the legacy per-member proxy port, the same for every member
const PROXY_PORT = 8080;

export class TooManyPasswordLinksError extends DomainError {
  constructor(username: string) {
    super(`${username} already got ${String(LINKS_PER_HOUR)} password links this hour`);
  }
}

// Unknown, expired or already used: one error, so the page never tells which.
export class PasswordLinkUnusableError extends DomainError {
  constructor() {
    super('this password link no longer works');
  }
}

export class MemberSuspendedError extends DomainError {
  constructor(username: string) {
    super(`${username} is suspended: no password link is sent to a suspended member`);
  }
}

interface Deps {
  readonly users: UserRepository;
  readonly credentials: PortalCredentialsPort;
  readonly links: PasswordLinkRepository;
  readonly outbox: MailOutboxPort;
  readonly queue: Pick<JobQueuePort, 'enqueue'>;
  readonly passwords: PasswordSealerPort;
  readonly tokens: SessionTokenPort;
  readonly address: PortalAddressPort;
  readonly clock: () => string;
}

// Mints a link, replaces whatever the member still had open, and mails it.
// Returns the link itself, which only an invitation ever shows to an admin.
async function mailPasswordLink(
  deps: Deps,
  member: {
    readonly username: Username;
    readonly email: EmailAddress;
    readonly language: Language | undefined;
    readonly purpose: PasswordLinkPurpose;
  },
): Promise<string> {
  const now = deps.clock();
  const issued = await deps.links.countIssuedSince(member.username, shift(now, -HOUR_MS));
  if (issued >= LINKS_PER_HOUR) {
    throw new TooManyPasswordLinksError(member.username.value);
  }
  const token = deps.tokens.generate();
  await deps.links.closeOpen(member.username, now);
  await deps.links.save(
    PasswordLink.issue({
      username: member.username,
      purpose: member.purpose,
      tokenHash: deps.tokens.hashToken(token),
      now,
    }),
    now,
  );
  const url = `${await deps.address.baseUrl()}/password-link/${token}`;
  await deps.outbox.enqueue(
    passwordLinkMail({
      recipient: member.email.value,
      username: member.username.value,
      purpose: member.purpose,
      language: member.language,
      url,
    }),
    now,
  );
  return url;
}

// An admin opens an account for someone: everything is created at once, with
// no password, and the member chooses theirs through the link.
export class InviteMember {
  constructor(private readonly deps: Deps) {}

  async execute(command: {
    readonly username: Username;
    readonly email: EmailAddress;
    readonly quota: Quota;
    readonly role: Role;
  }): Promise<{ readonly url: string }> {
    if (await this.deps.users.findByUsername(command.username)) {
      throw new UserAlreadyExistsError(command.username.value);
    }
    await this.deps.queue.enqueue(
      parseJob('create-user', {
        username: command.username.value,
        email: command.email.value,
        quotaBytes: command.quota.toBytes(),
        proxyPort: PROXY_PORT,
        role: command.role,
      }),
    );
    const url = await mailPasswordLink(this.deps, {
      username: command.username,
      email: command.email,
      language: undefined,
      purpose: 'invitation',
    });
    return { url };
  }
}

// An invitation again for a member who never chose a password, a reset for
// one who did. Only the invitation's link comes back, for an admin to pass on.
export class SendPasswordLink {
  constructor(private readonly deps: Deps) {}

  async execute(
    username: Username,
  ): Promise<{ readonly purpose: PasswordLinkPurpose; readonly url?: string }> {
    const user = await this.deps.users.findByUsername(username);
    if (user === undefined) {
      throw new UserNotFoundError(username.value);
    }
    if (user.status.isSuspended()) {
      throw new MemberSuspendedError(username.value);
    }
    const login = await this.deps.credentials.find(username);
    const purpose: PasswordLinkPurpose = login?.passwordHash === undefined ? 'invitation' : 'reset';
    const url = await mailPasswordLink(this.deps, {
      username,
      email: user.email,
      language: login?.language,
      purpose,
    });
    return purpose === 'invitation' ? { purpose, url } : { purpose };
  }
}

// "Forgot your password?": a username or an address in, a mail out if it
// names an active member, and the very same silence in every other case.
export class RequestPasswordReset {
  constructor(private readonly deps: Deps) {}

  async execute(identifier: string): Promise<void> {
    const user = await this.memberNamed(identifier.trim());
    if (user === undefined || user.status.isSuspended()) {
      return;
    }
    try {
      await new SendPasswordLink(this.deps).execute(user.username);
    } catch (error) {
      if (!(error instanceof TooManyPasswordLinksError)) {
        throw error;
      }
    }
  }

  private async memberNamed(identifier: string) {
    if (identifier.includes('@')) {
      let email: EmailAddress;
      try {
        email = EmailAddress.parse(identifier);
      } catch {
        return undefined;
      }
      return (await this.deps.users.listAll()).find((user) => user.email.value === email.value);
    }
    try {
      return await this.deps.users.findByUsername(Username.parse(identifier.toLowerCase()));
    } catch {
      return undefined;
    }
  }
}

// The member chose a password on the link's page: the link closes, and the
// password goes to the root worker sealed, which applies it everywhere.
export class SetPasswordFromLink {
  constructor(private readonly deps: Deps) {}

  // For the page that asks for the password: looking does not use the link,
  // so a mail scanner that opens it first cannot burn it.
  async isOpen(token: string): Promise<boolean> {
    const link = await this.deps.links.findByTokenHash(this.deps.tokens.hashToken(token));
    return link?.isOpen(this.deps.clock()) === true;
  }

  async execute(command: { readonly token: string; readonly password: Password }): Promise<Username> {
    const now = this.deps.clock();
    const link = await this.deps.links.findByTokenHash(this.deps.tokens.hashToken(command.token));
    if (!link?.isOpen(now)) {
      throw new PasswordLinkUnusableError();
    }
    await this.deps.links.save(link.use(now), now);
    await this.deps.queue.enqueue(
      parseJob('change-password', {
        username: link.username.value,
        sealedPassword: await this.deps.passwords.seal(command.password),
      }),
    );
    return link.username;
  }
}
