import type { NotificationPort } from '../../../domain/user/ports.js';
import type { UserEvent } from '../../../domain/user/events.js';

export class FakeNotifications implements NotificationPort {
  readonly published: UserEvent[] = [];

  notify(event: UserEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}
