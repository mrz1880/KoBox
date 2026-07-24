import type { TrackerEvent } from '../../../domain/tracker/events.js';
import type { TrackerNotificationPort } from '../../../domain/tracker/ports.js';
import type { NotificationPort } from '../../../domain/user/ports.js';
import type { UserEvent } from '../../../domain/user/events.js';

// One fake for both notification ports: composition wires a single adapter
// (console today, ntfy/email/discord in Phase 3) behind both interfaces.
export class FakeNotifications implements NotificationPort, TrackerNotificationPort {
  readonly published: (UserEvent | TrackerEvent)[] = [];

  notify(event: UserEvent | TrackerEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}
