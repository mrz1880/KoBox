import type { SecurityNotificationPort } from '../../domain/security/ports.js';
import type { TrackerNotificationPort } from '../../domain/tracker/ports.js';
import type { NotificationPort } from '../../domain/user/ports.js';
import type { Logger } from '../logging/logger.js';
import { formatEvent, type AnyDomainEvent, type NotificationChannel } from './formatEvent.js';

// The real multi-channel NotificationPort (frozen channels: ntfy + email +
// Discord). Fan-out is best-effort per channel: a dead webhook must never
// break the use case that raised the event, nor starve the other channels.
export class MultiChannelNotifier
  implements NotificationPort, TrackerNotificationPort, SecurityNotificationPort
{
  constructor(
    private readonly channels: readonly NotificationChannel[],
    private readonly logger: Logger,
  ) {}

  async notify(event: AnyDomainEvent): Promise<void> {
    const message = formatEvent(event);
    for (const channel of this.channels) {
      try {
        await channel.send(message);
      } catch (error) {
        this.logger.warn(
          { channel: channel.constructor.name, event: event.type, error },
          'notification channel failed',
        );
      }
    }
  }
}
