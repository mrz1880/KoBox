import type { CommandRunner } from '../system/CommandRunner.js';
import { SendmailTransport } from './SendmailTransport.js';
import type { FormattedEvent, NotificationChannel } from './formatEvent.js';

// Direct (non-durable) email channel: delivers immediately through the shared
// sendmail transport. Production wiring prefers OutboxEmailChannel; this one
// remains for contexts without a database (and for tests).
export class EmailChannel implements NotificationChannel {
  private readonly transport: SendmailTransport;

  constructor(
    runner: CommandRunner,
    private readonly recipient: string,
  ) {
    this.transport = new SendmailTransport(runner);
  }

  async send(message: FormattedEvent): Promise<void> {
    await this.transport.deliver({
      recipient: this.recipient,
      subject: message.title,
      body: message.body,
    });
  }
}
