import type { MailOutboxPort } from '../maintenance/MailOutboxPort.js';
import type { PortalAddressPort } from '../portal/PasswordLinks.js';
import { automaticCleanupMail, spaceRunningOutMail } from '../portal/spaceMails.js';
import type { PortalCredentialsPort } from '../../domain/portal/ports.js';
import type { CleanupReport } from '../../domain/space/CleanupReport.js';
import type { UserRepository } from '../../domain/user/ports.js';
import type { Quota } from '../../domain/user/Quota.js';
import type { Username } from '../../domain/user/Username.js';

// The portal page where a member picks what to delete; the portal's user
// routes serve it under this same path.
const CLEANUP_PAGE = '/space/cleanup';

export interface SpaceMailerDeps {
  readonly users: Pick<UserRepository, 'findByUsername'>;
  readonly credentials: Pick<PortalCredentialsPort, 'find'>;
  readonly address: PortalAddressPort;
  readonly outbox: Pick<MailOutboxPort, 'enqueue'>;
}

// What a member hears about their space, by mail, in their own language and
// with the link to their cleanup page. Only ever the member: their files are
// theirs, and an admin has the members page.
export class SpaceMailer {
  constructor(private readonly deps: SpaceMailerDeps) {}

  async runningOut(
    username: Username,
    space: { readonly used: Quota; readonly allowance: Quota; readonly freeable: Quota },
    at: string,
  ): Promise<void> {
    const member = await this.memberNamed(username);
    if (member === undefined) {
      return;
    }
    await this.deps.outbox.enqueue(
      spaceRunningOutMail({
        recipient: member.recipient,
        language: member.language,
        facts: { username: username.value, ...space, url: member.url },
      }),
      at,
    );
  }

  async automaticCleanup(username: Username, report: CleanupReport): Promise<void> {
    const member = await this.memberNamed(username);
    if (member === undefined) {
      return;
    }
    await this.deps.outbox.enqueue(
      automaticCleanupMail({
        recipient: member.recipient,
        language: member.language,
        username: username.value,
        report,
        url: member.url,
      }),
      report.at,
    );
  }

  // A member deleted meanwhile has nobody left to tell.
  private async memberNamed(username: Username) {
    const user = await this.deps.users.findByUsername(username);
    if (user === undefined) {
      return undefined;
    }
    const login = await this.deps.credentials.find(username);
    return {
      recipient: user.email.value,
      language: login?.language,
      url: `${await this.deps.address.baseUrl()}${CLEANUP_PAGE}`,
    };
  }
}
