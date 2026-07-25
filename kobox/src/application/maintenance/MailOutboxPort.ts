export type MailStatus = 'pending' | 'sent' | 'failed';

export interface OutboxMailDraft {
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
}

export interface OutboxMail extends OutboxMailDraft {
  readonly id: number;
  readonly status: MailStatus;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastError?: string;
  readonly createdAt: string;
  readonly sentAt?: string;
}

// The durable outbox: notifications insert, the scheduled send-mails job
// flushes. No claim/running state — the single root worker is the only
// flusher, and a crash mid-send simply retries at the next tick.
export interface MailOutboxPort {
  enqueue(draft: OutboxMailDraft, now: string): Promise<number>;
  listDue(now: string, limit: number): Promise<readonly OutboxMail[]>;
  markSent(id: number, now: string): Promise<void>;
  markRetry(id: number, error: string, nextAttemptAt: string): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
  listRecent(limit: number): Promise<readonly OutboxMail[]>;
}
