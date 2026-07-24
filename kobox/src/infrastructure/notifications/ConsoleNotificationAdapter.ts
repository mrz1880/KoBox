import type { SecurityEvent } from '../../domain/security/events.js';
import type { SecurityNotificationPort } from '../../domain/security/ports.js';
import type { TrackerEvent } from '../../domain/tracker/events.js';
import type { TrackerNotificationPort } from '../../domain/tracker/ports.js';
import type { NotificationPort } from '../../domain/user/ports.js';
import type { UserEvent } from '../../domain/user/events.js';
import type { Logger } from '../logging/logger.js';

type AnyEvent = UserEvent | TrackerEvent | SecurityEvent;

function subjectOf(event: AnyEvent): string {
  if ('username' in event) {
    return event.username;
  }
  if ('host' in event) {
    return event.host;
  }
  if ('outcome' in event) {
    return event.outcome;
  }
  return `${event.author}/${event.name}`;
}

// Phase 0 stub, widened per phase: real channels (ntfy/email/discord) arrive
// with the fair-use work; the ports are the seam they plug into.
export class ConsoleNotificationAdapter
  implements NotificationPort, TrackerNotificationPort, SecurityNotificationPort
{
  constructor(private readonly logger: Logger) {}

  notify(event: AnyEvent): Promise<void> {
    this.logger.info({ event }, `domain event: ${event.type} ${subjectOf(event)}`);
    return Promise.resolve();
  }
}
