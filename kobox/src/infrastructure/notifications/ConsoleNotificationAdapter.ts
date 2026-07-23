import type { NotificationPort } from '../../domain/user/ports.js';
import type { UserEvent } from '../../domain/user/events.js';
import type { Logger } from '../logging/logger.js';

// Phase 0 stub: real channels (ntfy/email/discord) arrive with the fair-use
// work; the port is the seam they will plug into.
export class ConsoleNotificationAdapter implements NotificationPort {
  constructor(private readonly logger: Logger) {}

  notify(event: UserEvent): Promise<void> {
    this.logger.info({ event }, `user event: ${event.type} ${event.username}`);
    return Promise.resolve();
  }
}
