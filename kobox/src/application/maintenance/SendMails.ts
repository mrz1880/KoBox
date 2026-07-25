import {
  MAX_MAIL_ATTEMPTS,
  nextAttemptDelayMinutes,
} from '../../domain/maintenance/outbox.js';
import type { MailOutboxPort } from './MailOutboxPort.js';
import type { MailTransportPort } from './MailTransportPort.js';

export interface SendMailsDeps {
  readonly outbox: MailOutboxPort;
  readonly transport: MailTransportPort;
}

export interface SendMailsInput {
  readonly now: string;
}

export interface SendMailsReport {
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
}

const BATCH_LIMIT = 20;

function addMinutes(stamp: string, minutes: number): string {
  const date = new Date(`${stamp.replace(' ', 'T')}Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// The legacy SendMails.bsh, typed: flush due outbox rows through the relay,
// let the backoff ladder absorb transient failures, keep dead mails visible.
export class SendMails {
  constructor(private readonly deps: SendMailsDeps) {}

  async execute(input: SendMailsInput): Promise<SendMailsReport> {
    const due = await this.deps.outbox.listDue(input.now, BATCH_LIMIT);
    let sent = 0;
    let retried = 0;
    let failed = 0;
    for (const mail of due) {
      try {
        await this.deps.transport.deliver({
          recipient: mail.recipient,
          subject: mail.subject,
          body: mail.body,
        });
        await this.deps.outbox.markSent(mail.id, input.now);
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attemptsSoFar = mail.attempts + 1;
        const delay =
          attemptsSoFar >= MAX_MAIL_ATTEMPTS ? undefined : nextAttemptDelayMinutes(attemptsSoFar);
        if (delay === undefined) {
          await this.deps.outbox.markFailed(mail.id, message);
          failed += 1;
        } else {
          await this.deps.outbox.markRetry(mail.id, message, addMinutes(input.now, delay));
          retried += 1;
        }
      }
    }
    return { sent, retried, failed };
  }
}
