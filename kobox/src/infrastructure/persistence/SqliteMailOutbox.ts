import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import type {
  MailOutboxPort,
  OutboxMail,
  OutboxMailDraft,
} from '../../application/maintenance/MailOutboxPort.js';
import type { KoboxDatabase } from './db.js';
import { mails } from './schema.js';

type MailRow = typeof mails.$inferSelect;

function toMail(row: MailRow): OutboxMail {
  return {
    id: row.id,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    ...(row.lastError !== null && { lastError: row.lastError }),
    createdAt: row.createdAt,
    ...(row.sentAt !== null && { sentAt: row.sentAt }),
  };
}

export class SqliteMailOutbox implements MailOutboxPort {
  constructor(private readonly db: KoboxDatabase) {}

  enqueue(draft: OutboxMailDraft, now: string): Promise<number> {
    const inserted = this.db.orm
      .insert(mails)
      .values({
        recipient: draft.recipient,
        subject: draft.subject,
        body: draft.body,
        nextAttemptAt: now,
        createdAt: now,
      })
      .returning({ id: mails.id })
      .get();
    return Promise.resolve(inserted.id);
  }

  listDue(now: string, limit: number): Promise<readonly OutboxMail[]> {
    const rows = this.db.orm
      .select()
      .from(mails)
      .where(and(eq(mails.status, 'pending'), lte(mails.nextAttemptAt, now)))
      .orderBy(asc(mails.id))
      .limit(limit)
      .all();
    return Promise.resolve(rows.map(toMail));
  }

  markSent(id: number, now: string): Promise<void> {
    this.db.orm
      .update(mails)
      .set({ status: 'sent', sentAt: now, lastError: null })
      .where(eq(mails.id, id))
      .run();
    return Promise.resolve();
  }

  markRetry(id: number, error: string, nextAttemptAt: string): Promise<void> {
    this.db.orm
      .update(mails)
      .set({ attempts: sql`${mails.attempts} + 1`, lastError: error, nextAttemptAt })
      .where(eq(mails.id, id))
      .run();
    return Promise.resolve();
  }

  markFailed(id: number, error: string): Promise<void> {
    this.db.orm
      .update(mails)
      .set({ status: 'failed', attempts: sql`${mails.attempts} + 1`, lastError: error })
      .where(eq(mails.id, id))
      .run();
    return Promise.resolve();
  }

  listRecent(limit: number): Promise<readonly OutboxMail[]> {
    const rows = this.db.orm.select().from(mails).orderBy(desc(mails.id)).limit(limit).all();
    return Promise.resolve(rows.map(toMail));
  }
}
