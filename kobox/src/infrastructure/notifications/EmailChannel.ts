import { runOrThrow, type CommandRunner } from '../system/CommandRunner.js';
import type { FormattedEvent, NotificationChannel } from './formatEvent.js';

// Rides the existing Postfix relay: sendmail -t reads the envelope from the
// message itself (argv-only, message via stdin).
export class EmailChannel implements NotificationChannel {
  constructor(
    private readonly runner: CommandRunner,
    private readonly recipient: string,
  ) {}

  async send(message: FormattedEvent): Promise<void> {
    const mail = [
      `To: ${this.recipient}`,
      `Subject: ${message.title}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.body,
      '',
    ].join('\n');
    await runOrThrow(this.runner, {
      command: 'sendmail',
      args: ['-t'],
      stdin: mail,
      timeoutMs: 10_000,
    });
  }
}
