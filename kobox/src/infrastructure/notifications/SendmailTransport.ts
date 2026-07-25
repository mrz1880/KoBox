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
    const message = [
      `To: ${mail.recipient}`,
      `Subject: ${mail.subject}`,
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
