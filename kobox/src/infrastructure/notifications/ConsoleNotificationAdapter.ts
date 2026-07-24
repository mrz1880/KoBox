import type { TrackerEvent } from '../../domain/tracker/events.js';
import type { TrackerNotificationPort } from '../../domain/tracker/ports.js';
import type { NotificationPort } from '../../domain/user/ports.js';
import type { UserEvent } from '../../domain/user/events.js';
import type { Logger } from '../logging/logger.js';

function subjectOf(event: UserEvent | TrackerEvent): string {
  if ('username' in event) {
    return event.username;
  }
  if ('host' in event) {
    return event.host;
  }
  return `${event.author}/${event.name}`;
}

// Phase 0 stub, widened to tracker events in Phase 2: real channels
// (ntfy/email/discord) arrive with the fair-use work; the ports are the seam
// they will plug into.
export class ConsoleNotificationAdapter implements NotificationPort, TrackerNotificationPort {
  constructor(private readonly logger: Logger) {}

  notify(event: UserEvent | TrackerEvent): Promise<void> {
    this.logger.info({ event }, `domain event: ${event.type} ${subjectOf(event)}`);
    return Promise.resolve();
  }
}
