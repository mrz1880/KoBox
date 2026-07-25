import type {
  MailOutboxPort,
  MailStatus,
  OutboxMail,
  OutboxMailDraft,
} from '../../application/maintenance/MailOutboxPort.js';

interface MutableMail {
  readonly id: number;
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  status: MailStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  readonly createdAt: string;
  sentAt?: string;
}

function snapshot(row: MutableMail): OutboxMail {
  return {
    id: row.id,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    ...(row.lastError !== undefined && { lastError: row.lastError }),
    createdAt: row.createdAt,
    ...(row.sentAt !== undefined && { sentAt: row.sentAt }),
  };
}

export class InMemoryMailOutbox implements MailOutboxPort {
  private readonly rows: MutableMail[] = [];
  private nextId = 1;

  enqueue(draft: OutboxMailDraft, now: string): Promise<number> {
    const id = this.nextId++;
    this.rows.push({
      id,
      recipient: draft.recipient,
      subject: draft.subject,
      body: draft.body,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    });
    return Promise.resolve(id);
  }

  listDue(now: string, limit: number): Promise<readonly OutboxMail[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.status === 'pending' && row.nextAttemptAt <= now)
        .slice(0, limit)
        .map(snapshot),
    );
  }

  markSent(id: number, now: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = 'sent';
      row.sentAt = now;
      delete row.lastError;
    }
    return Promise.resolve();
  }

  markRetry(id: number, error: string, nextAttemptAt: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.attempts += 1;
      row.lastError = error;
      row.nextAttemptAt = nextAttemptAt;
    }
    return Promise.resolve();
  }

  markFailed(id: number, error: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.status = 'failed';
      row.attempts += 1;
      row.lastError = error;
    }
    return Promise.resolve();
  }

  listRecent(limit: number): Promise<readonly OutboxMail[]> {
    return Promise.resolve([...this.rows].reverse().slice(0, limit).map(snapshot));
  }
}
