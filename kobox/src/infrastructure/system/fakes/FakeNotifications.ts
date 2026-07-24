import type { SecurityEvent } from '../../../domain/security/events.js';
import type { SecurityNotificationPort } from '../../../domain/security/ports.js';
import type { TrackerEvent } from '../../../domain/tracker/events.js';
import type { TrackerNotificationPort } from '../../../domain/tracker/ports.js';
import type { NotificationPort } from '../../../domain/user/ports.js';
import type { UserEvent } from '../../../domain/user/events.js';

// One fake for all three notification ports: composition wires a single
// adapter (console today, ntfy/email/discord in Phase 3) behind them.
export class FakeNotifications
  implements NotificationPort, TrackerNotificationPort, SecurityNotificationPort
{
  readonly published: (UserEvent | TrackerEvent | SecurityEvent)[] = [];

  notify(event: UserEvent | TrackerEvent | SecurityEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}
