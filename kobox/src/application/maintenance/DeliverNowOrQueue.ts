import type {
  MailOutboxPort,
  OutboxMail,
  OutboxMailDraft,
} from './MailOutboxPort.js';
import type { MailTransportPort } from './MailTransportPort.js';

// A mail goes to the local relay the moment it is written, rather than at the
// next five-minute pass. Once the relay accepted it, it is on the relay's disk
// and the relay retries on its own: it is recorded as sent, so nothing sends it
// twice. A relay that refuses or does not answer took nothing: the mail joins
// the outbox, and the pass and its retry ladder take over as before.
export class DeliverNowOrQueue implements MailOutboxPort {
  constructor(
    private readonly outbox: MailOutboxPort,
    private readonly relay: MailTransportPort,
  ) {}

  async enqueue(draft: OutboxMailDraft, now: string): Promise<number> {
    try {
      await this.relay.deliver(draft);
    } catch {
      return this.outbox.enqueue(draft, now);
    }
    return this.outbox.recordSent(draft, now);
  }

  recordSent(draft: OutboxMailDraft, now: string): Promise<number> {
    return this.outbox.recordSent(draft, now);
  }

  listDue(now: string, limit: number): Promise<readonly OutboxMail[]> {
    return this.outbox.listDue(now, limit);
  }

  markSent(id: number, now: string): Promise<void> {
    return this.outbox.markSent(id, now);
  }

  markRetry(id: number, error: string, nextAttemptAt: string): Promise<void> {
    return this.outbox.markRetry(id, error, nextAttemptAt);
  }

  markFailed(id: number, error: string): Promise<void> {
    return this.outbox.markFailed(id, error);
  }

  listRecent(limit: number): Promise<readonly OutboxMail[]> {
    return this.outbox.listRecent(limit);
  }
}
