import { callsForAnAdmin } from '../../domain/shared/attention.js';
import type { SecurityNotificationPort } from '../../domain/security/ports.js';
import type { TrackerNotificationPort } from '../../domain/tracker/ports.js';
import type { NotificationPort } from '../../domain/user/ports.js';
import type { Logger } from '../logging/logger.js';
import type { AnyDomainEvent } from './formatEvent.js';

// Lets through to the channels only what an admin has to act on. The rest is
// written to the worker's log, so nothing that happened goes unrecorded.
export class OnlyWhatCallsForAnAdmin
  implements NotificationPort, TrackerNotificationPort, SecurityNotificationPort
{
  constructor(
    private readonly notifier: { notify(event: AnyDomainEvent): Promise<void> },
    private readonly logger: Logger,
  ) {}

  async notify(event: AnyDomainEvent): Promise<void> {
    if (!callsForAnAdmin(event)) {
      this.logger.info({ event }, 'event left to the portal, not sent');
      return;
    }
    await this.notifier.notify(event);
  }
}
