import type { MailOutboxPort } from '../../application/maintenance/MailOutboxPort.js';
import type { FormattedEvent, NotificationChannel } from './formatEvent.js';

// The durable email channel: notifications land in the mails table and the
// scheduled send-mails job flushes them — a relay outage delays alerts
// instead of dropping them (AUDIT §1.7 outbox).
export class OutboxEmailChannel implements NotificationChannel {
  constructor(
    private readonly outbox: MailOutboxPort,
    private readonly recipient: string,
    private readonly now: () => string,
  ) {}

  async send(message: FormattedEvent): Promise<void> {
    await this.outbox.enqueue(
      { recipient: this.recipient, subject: message.title, body: message.body },
      this.now(),
    );
  }
}
