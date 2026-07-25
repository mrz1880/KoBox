import type {
  MailDelivery,
  MailTransportPort,
} from '../../application/maintenance/MailTransportPort.js';
import { runOrThrow, type CommandRunner } from '../system/CommandRunner.js';

// Rides the local Postfix relay: sendmail -t reads the envelope from the
// message itself (argv-only, message via stdin). Shared by the direct
// EmailChannel and the outbox flusher — one message format, one seam.
export class SendmailTransport implements MailTransportPort {
  constructor(private readonly runner: CommandRunner) {}

  async deliver(mail: MailDelivery): Promise<void> {
    // header values are one line by definition: stripping CR/LF closes the
    // header-injection class even if a future caller forwards user text
    const headerSafe = (value: string): string => value.replace(/[\r\n]+/g, ' ');
    const message = [
      `To: ${headerSafe(mail.recipient)}`,
      `Subject: ${headerSafe(mail.subject)}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      mail.body,
      '',
    ].join('\n');
    await runOrThrow(this.runner, {
      command: 'sendmail',
      args: ['-t'],
      stdin: message,
      timeoutMs: 10_000,
    });
  }
}
