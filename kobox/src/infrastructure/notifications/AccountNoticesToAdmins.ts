import type { MailOutboxPort } from '../../application/maintenance/MailOutboxPort.js';
import type { PortalCredentialsPort } from '../../domain/portal/ports.js';
import type { SecurityNotificationPort } from '../../domain/security/ports.js';
import type { TrackerNotificationPort } from '../../domain/tracker/ports.js';
import type { EmailAddress } from '../../domain/user/EmailAddress.js';
import { concernsEveryAdmin } from '../../domain/user/events.js';
import type { NotificationPort, UserRepository } from '../../domain/user/ports.js';
import {
  formatEvent,
  type AnyDomainEvent,
  type NotificationContext,
} from './formatEvent.js';

interface Deps {
  // the box's own channels (alert address, ntfy, Discord), which get everything
  readonly operator: { notify(event: AnyDomainEvent): Promise<void> };
  readonly users: UserRepository;
  readonly credentials: PortalCredentialsPort;
  readonly outbox: MailOutboxPort;
  readonly context: () => Promise<NotificationContext>;
  readonly now: () => string;
  // an admin whose address is the operator's alert address already has it
  readonly alreadyMailed?: EmailAddress;
}

// Everything goes to the operator's channels as before; an account event also
// goes, by mail, to every admin, read from the roles at the time it happens.
export class AccountNoticesToAdmins
  implements NotificationPort, TrackerNotificationPort, SecurityNotificationPort
{
  constructor(private readonly deps: Deps) {}

  async notify(event: AnyDomainEvent): Promise<void> {
    await this.deps.operator.notify(event);
    if (!concernsEveryAdmin(event)) {
      return;
    }
    const message = formatEvent(event, await this.deps.context());
    for (const address of await this.adminAddresses()) {
      await this.deps.outbox.enqueue(
        { recipient: address.value, subject: message.title, body: message.body },
        this.deps.now(),
      );
    }
  }

  private async adminAddresses(): Promise<readonly EmailAddress[]> {
    const addresses: EmailAddress[] = [];
    for (const user of await this.deps.users.listAll()) {
      const login = await this.deps.credentials.find(user.username);
      if (login?.role === 'admin' && user.email.value !== this.deps.alreadyMailed?.value) {
        addresses.push(user.email);
      }
    }
    return addresses;
  }
}
